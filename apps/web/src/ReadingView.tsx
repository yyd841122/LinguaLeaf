import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";

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

// EPUB/Markdown illustrations become placeholder blocks at their reading
// position (ticket 07): the alt text captions the placeholder, the image
// bytes themselves are not rendered.
export type ImageBlock = {
  position: number;
  kind: "image";
  originalText: string;
};

export type Block = SentenceBlock | PassthroughBlock | ImageBlock;

export type ChapterContent = {
  position: number;
  title: string;
  blocks: Block[];
};

// Same word rule as the server's tokenizer (apps/server/src/dict/ipa-line.ts):
// slot i of ipaSlots belongs to the i-th match of this pattern in
// originalText. Keep the two patterns identical or pairing silently breaks.
const WORD_PATTERN = /\p{L}+(?:['’-]\p{L}+)*/gu;

// Renders the sentence as clickable word units — the word, its IPA beneath
// when slots pair — so every transcription stays attached to its own word at
// any line wrap (ticket 03) and every word is a lookup target (ticket 06).
// Words without a slot, and the punctuation between words, stay as plain
// text. The surface form rides on data-word for the click delegation.
function WordSegments({
  block,
  showSlots,
}: {
  block: SentenceBlock;
  showSlots: boolean;
}) {
  const segments: ReactNode[] = [];
  let cursor = 0;
  let index = 0;
  for (const match of block.originalText.matchAll(WORD_PATTERN)) {
    const start = match.index ?? cursor;
    if (start > cursor) {
      segments.push(block.originalText.slice(cursor, start));
    }
    const ipa = showSlots ? block.ipaSlots?.[index] : undefined;
    segments.push(
      ipa ? (
        <span className="ipa-word" data-word={match[0]} key={index}>
          <span className="ipa-word-text">{match[0]}</span>
          <span className="ipa-word-ipa">{ipa}</span>
        </span>
      ) : (
        <span className="lookup-word" data-word={match[0]} key={index}>
          {match[0]}
        </span>
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
  // reader wants IPA at all. With IPA hidden the word units stay (lookups
  // work regardless of the toggle) — they just carry no transcription.
  const slotPaired =
    block.ipaSlots !== null && block.ipaSlots.length === wordCount;
  const paired = showIpa && slotPaired;
  return (
    <div className="sentence-block" data-position={block.position}>
      <p className="original-line">
        <WordSegments block={block} showSlots={paired} />
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
  if (block.kind === "image") {
    return (
      <figure className="image-block" data-position={block.position}>
        <span className="image-placeholder" aria-hidden="true">
          🖼
        </span>
        {block.originalText ? (
          <figcaption>{block.originalText}</figcaption>
        ) : null}
      </figure>
    );
  }
  return (
    <p className="raw-block" data-position={block.position}>
      {block.originalText}
    </p>
  );
}

// Where a click happened, in viewport coordinates. Clicks carry 0/0 in
// synthetic environments; real clicks carry the pointer position.
export type ClickPoint = { x: number; y: number };

// A word click: the surface form as it stands in the text, plus where it
// happened — the popup anchors there.
export type WordClick = { word: string; point: ClickPoint };

export function ReadingView({
  chapter,
  ipaSize,
  originalSize,
  translationSize,
  showIpa = true,
  showTranslation = true,
  onWordClick,
}: {
  chapter: ChapterContent;
  ipaSize?: number;
  originalSize?: number;
  translationSize?: number;
  showIpa?: boolean;
  showTranslation?: boolean;
  onWordClick?: (click: WordClick) => void;
}) {
  // One delegated listener for the whole chapter: word units carry
  // data-word, everything else (punctuation, annotation lines, code blocks)
  // stays inert.
  const handleWordClick = (event: ReactMouseEvent<HTMLElement>) => {
    if (!onWordClick) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    const word = target.closest("[data-word]")?.getAttribute("data-word");
    if (word) {
      onWordClick({ word, point: { x: event.clientX, y: event.clientY } });
    }
  };
  return (
    <section
      className="reading"
      aria-labelledby="chapter-title"
      onClick={handleWordClick}
      style={
        {
          ...(ipaSize === undefined ? null : { "--ipa-size": `${ipaSize}px` }),
          ...(originalSize === undefined
            ? null
            : { "--original-size": `${originalSize}px` }),
          ...(translationSize === undefined
            ? null
            : { "--translation-size": `${translationSize}px` }),
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
