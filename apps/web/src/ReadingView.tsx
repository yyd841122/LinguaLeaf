import type { ReactNode } from "react";

export type SentenceBlock = {
  position: number;
  kind: "sentence";
  originalText: string;
  ipaSlots: string[] | null;
  ipaText: string | null;
  translationText: string | null;
};

export type PassthroughBlock = {
  position: number;
  kind: "code" | "raw";
  originalText: string;
};

export type Block = SentenceBlock | PassthroughBlock;

export type ChapterContent = {
  position: number;
  title: string;
  blocks: Block[];
};

// Same word rule as the server's tokenizer (apps/server/src/dict/ipa-line.ts):
// slot i of ipaSlots belongs to the i-th match of this pattern in
// originalText. Keep the two patterns identical or pairing silently breaks.
const WORD_PATTERN = /\p{L}+(?:['’-]\p{L}+)*/gu;

// Renders the sentence as inline word units — the word on top, its IPA
// directly beneath — so every transcription stays attached to its own word
// at any line wrap (ticket 03 acceptance feedback). Words without a slot,
// and the punctuation between words, stay as plain text.
function WordSegments({ block }: { block: SentenceBlock }) {
  const segments: ReactNode[] = [];
  let cursor = 0;
  let index = 0;
  for (const match of block.originalText.matchAll(WORD_PATTERN)) {
    const start = match.index ?? cursor;
    if (start > cursor) {
      segments.push(block.originalText.slice(cursor, start));
    }
    const ipa = block.ipaSlots?.[index];
    segments.push(
      ipa ? (
        <span className="ipa-word" key={index}>
          <span className="ipa-word-text">{match[0]}</span>
          <span className="ipa-word-ipa">{ipa}</span>
        </span>
      ) : (
        <span key={index}>{match[0]}</span>
      )
    );
    cursor = start + match[0].length;
    index += 1;
  }
  segments.push(block.originalText.slice(cursor));
  return <>{segments}</>;
}

// One sentence block: the original line (words paired with their IPA when
// the import stored slots), plus the translation line. Books imported
// before slots existed fall back to the flat IPA line under the sentence.
// The annotation lines are individually hideable (ticket 05 toggles); the
// original line never is.
function SentenceBlockView({
  block,
  showIpa,
  showTranslation,
}: {
  block: SentenceBlock;
  showIpa: boolean;
  showTranslation: boolean;
}) {
  const wordCount = [...block.originalText.matchAll(WORD_PATTERN)].length;
  // Two separate facts: whether slots pair with the words, and whether the
  // reader wants IPA at all. With IPA hidden the original line renders as
  // plain text — the word units exist to carry the transcriptions.
  const slotPaired =
    block.ipaSlots !== null && block.ipaSlots.length === wordCount;
  const paired = showIpa && slotPaired;
  return (
    <div className="sentence-block" data-position={block.position}>
      <p className="original-line">
        {paired ? <WordSegments block={block} /> : block.originalText}
      </p>
      {showIpa && !slotPaired ? (
        <p className="ipa-line">{block.ipaText ?? ""}</p>
      ) : null}
      {showTranslation ? (
        <p className="translation-line">{block.translationText ?? ""}</p>
      ) : null}
    </div>
  );
}

function BlockView({
  block,
  showIpa,
  showTranslation,
}: {
  block: Block;
  showIpa: boolean;
  showTranslation: boolean;
}) {
  if (block.kind === "sentence") {
    return (
      <SentenceBlockView
        block={block}
        showIpa={showIpa}
        showTranslation={showTranslation}
      />
    );
  }
  if (block.kind === "code") {
    return (
      <pre className="code-block" data-position={block.position}>
        <code>{block.originalText}</code>
      </pre>
    );
  }
  return (
    <p className="raw-block" data-position={block.position}>
      {block.originalText}
    </p>
  );
}

export function ReadingView({
  chapter,
  ipaSize,
  originalSize,
  showIpa = true,
  showTranslation = true,
}: {
  chapter: ChapterContent;
  ipaSize?: number;
  originalSize?: number;
  showIpa?: boolean;
  showTranslation?: boolean;
}) {
  return (
    <section
      className="reading"
      aria-labelledby="chapter-title"
      style={
        {
          ...(ipaSize === undefined ? null : { "--ipa-size": `${ipaSize}px` }),
          ...(originalSize === undefined
            ? null
            : { "--original-size": `${originalSize}px` }),
        } as React.CSSProperties
      }
    >
      <h1 id="chapter-title">{chapter.title}</h1>
      <div className="blocks">
        {chapter.blocks.map((block) => (
          <BlockView
            key={block.position}
            block={block}
            showIpa={showIpa}
            showTranslation={showTranslation}
          />
        ))}
      </div>
    </section>
  );
}
