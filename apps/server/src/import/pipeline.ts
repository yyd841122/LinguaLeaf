import type Database from "better-sqlite3";
import type { Dictionary } from "../dict/dictionary.js";
import { buildIpaSlots } from "../dict/ipa-line.js";
import { translateChapters } from "../translate/batch.js";
import type { Translator } from "../translate/translator.js";
import { MARKDOWN_EXTENSION, renderMarkdownToChapters } from "./markdown.js";
import { splitSentences } from "./sentences.js";

export type ImportedBook = {
  id: number;
  title: string;
  format: "markdown";
  createdAt: string;
};

// One prepared block row: everything the insert needs, derived in a single
// pass over the extracted chapters so the translation alignment below can
// never drift from what gets inserted.
type BlockRow = {
  kind: "sentence" | "code" | "raw";
  text: string;
  ipaSlots: string[] | null;
  ipaText: string | null;
  translation: string | null;
};

// Runs the whole import: extraction, sentence splitting, per-word IPA
// lookups against the local dictionary (all fast), plus — when a
// translator is configured — batched translation of every sentence before
// the insert transaction (ticket 04; spec ADR: 标注在导入时一次性生成).
// Like an empty dictionary leaves IPA lines blank, a missing translator
// leaves translation lines empty instead of failing the import; sentences
// whose translation finally fails store NULL (spec: 单句失败不阻塞整本导入).
export async function importMarkdownBook(
  database: Database.Database,
  upload: { filename: string; content: string },
  dictionary: Dictionary,
  translator?: Translator | null
): Promise<ImportedBook> {
  const chapters = renderMarkdownToChapters(upload.content);
  // Prefer the book's own first heading, then the file name.
  const fileTitle = upload.filename.replace(MARKDOWN_EXTENSION, "").trim();
  const title =
    chapters.find((chapter) => chapter.level !== null)?.title ??
    (fileTitle || "Untitled");
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

  const importBook = database.transaction((): number => {
    const bookId = Number(
      database
        .prepare(
          "INSERT INTO books (title, format, created_at) VALUES (?, ?, ?)"
        )
        .run(title, "markdown", createdAt).lastInsertRowid
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

  return { id: importBook(), title, format: "markdown", createdAt };
}
