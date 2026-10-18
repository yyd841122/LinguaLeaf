import type Database from "better-sqlite3";
import type { Dictionary } from "../dict/dictionary.js";
import { buildIpaSlots } from "../dict/ipa-line.js";
import { translateChapters } from "../translate/batch.js";
import type { Translator } from "../translate/translator.js";
import type { ExtractedChapter } from "./extract-html.js";
import { splitSentences } from "./sentences.js";

export type BookFormat = "markdown" | "epub";

// The block kinds the data model stores — mirrors the blocks.kind CHECK in
// schema.ts (SQL cannot import it) and the cast in books-router.ts; adding
// a kind means touching this union and the schema CHECK together.
export type BlockKind = "sentence" | "code" | "raw" | "image";

// What the format-specific front halves (markdown.ts, epub.ts) hand to the
// shared import: extracted chapters plus the book title. Everything past
// this type — sentence splitting, IPA, translation, insert — is one path.
export type PreparedBook = {
  title: string;
  format: BookFormat;
  chapters: ExtractedChapter[];
};

export type ImportedBook = {
  id: number;
  title: string;
  format: BookFormat;
  createdAt: string;
};

// One prepared block row: everything the insert needs, derived in a single
// pass over the extracted chapters so the translation alignment below can
// never drift from what gets inserted.
type BlockRow = {
  kind: BlockKind;
  text: string;
  ipaSlots: string[] | null;
  ipaText: string | null;
  translation: string | null;
};

// Runs the whole import: sentence splitting, per-word IPA lookups against
// the local dictionary (all fast), plus — when a translator is configured —
// batched translation of every sentence before the insert transaction
// (ticket 04; spec ADR: 标注在导入时一次性生成). Like an empty dictionary
// leaves IPA lines blank, a missing translator leaves translation lines empty
// instead of failing the import; sentences whose translation finally fails
// store NULL (spec: 单句失败不阻塞整本导入).
export async function importBook(
  database: Database.Database,
  book: PreparedBook,
  dictionary: Dictionary,
  translator?: Translator | null
): Promise<ImportedBook> {
  const { title, format, chapters } = book;
  const createdAt = new Date().toISOString();

  const chapterBlocks: BlockRow[][] = chapters.map((chapter) => {
    const blocks: BlockRow[] = [];
    for (const item of chapter.items) {
      if (item.kind === "paragraph") {
        for (const sentence of splitSentences(item.text)) {
          const slots = buildIpaSlots(dictionary, sentence);
          blocks.push({
            kind: "sentence",
            text: sentence,
            ipaSlots: slots,
            ipaText: slots.join(" ").trim(),
            translation: null,
          });
        }
      } else if (item.kind === "image") {
        // Images stay placeholder blocks in their reading position; the
        // alt text rides in original_text (ticket 07).
        blocks.push({
          kind: "image",
          text: item.text,
          ipaSlots: null,
          ipaText: null,
          translation: null,
        });
      } else {
        // Code and passthrough items are never annotated (spec: 代码块与
        // 链接不做标注), so their annotation columns stay NULL.
        blocks.push({
          kind: item.kind,
          text: item.text,
          ipaSlots: null,
          ipaText: null,
          translation: null,
        });
      }
    }
    return blocks;
  });

  const sentencesByChapter = chapterBlocks.map((blocks) =>
    blocks
      .filter((block) => block.kind === "sentence")
      .map((block) => block.text)
  );
  const translationsByChapter = translator
    ? await translateChapters(translator, sentencesByChapter)
    : sentencesByChapter.map(() => [] as (string | null)[]);
  chapterBlocks.forEach((blocks, chapterIndex) => {
    const translations = translationsByChapter[chapterIndex] ?? [];
    let sentenceIndex = 0;
    for (const block of blocks) {
      if (block.kind === "sentence") {
        block.translation = translations[sentenceIndex] ?? null;
        sentenceIndex += 1;
      }
    }
  });

  const importBookRow = database.transaction((): number => {
    const bookId = Number(
      database
        .prepare(
          "INSERT INTO books (title, format, created_at) VALUES (?, ?, ?)"
        )
        .run(title, format, createdAt).lastInsertRowid
    );
    const insertChapter = database.prepare(
      "INSERT INTO chapters (book_id, position, title, level) VALUES (?, ?, ?, ?)"
    );
    const insertBlock = database.prepare(
      "INSERT INTO blocks (chapter_id, position, kind, original_text, ipa_slots, ipa_text, translation_text) VALUES (?, ?, ?, ?, ?, ?, ?)"
    );
    chapters.forEach((chapter, chapterIndex) => {
      const chapterId = Number(
        insertChapter.run(
          bookId,
          chapterIndex + 1,
          chapter.title,
          chapter.level
        ).lastInsertRowid
      );
      let position = 0;
      for (const block of chapterBlocks[chapterIndex] ?? []) {
        position += 1;
        insertBlock.run(
          chapterId,
          position,
          block.kind,
          block.text,
          block.ipaSlots === null ? null : JSON.stringify(block.ipaSlots),
          block.ipaText,
          block.translation
        );
      }
    });
    return bookId;
  });

  return { id: importBookRow(), title, format, createdAt };
}
