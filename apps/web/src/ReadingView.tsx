import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  ReactNode,
} from "react";
import { memo } from "react";
import { segmentOriginal, type Segment } from "@lingualeaf/reading-model";

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

// Renders the sentence as clickable word units — the word, its IPA beneath
// when slots pair — so every transcription stays attached to its own word at
// any line wrap (ticket 03) and every word is a lookup target (ticket 06).
// Words without a slot, and the punctuation between words, stay as plain
// text. The surface form rides on data-word for the click delegation. The
// walk itself is the reading model's segmentOriginal; this is its JSX half.
function WordSegments({
  segments,
  showSlots,
}: {
  segments: Segment[];
  showSlots: boolean;
}) {
  const nodes: ReactNode[] = [];
  let index = 0;
  for (const segment of segments) {
    if (segment.kind === "text") {
      nodes.push(segment.text);
      continue;
    }
    const ipa = showSlots ? segment.ipa : undefined;
    nodes.push(
      ipa ? (
        <span
          className="ipa-word"
          data-word={segment.word}
          key={index}
          role="button"
          tabIndex={0}
        >
          <span className="ipa-word-text">{segment.word}</span>
          <span className="ipa-word-ipa">{ipa}</span>
        </span>
      ) : (
        <span
          className="lookup-word"
          data-word={segment.word}
          key={index}
          role="button"
          tabIndex={0}
        >
          {segment.word}
        </span>
      )
    );
    index += 1;
  }
  return <>{nodes}</>;
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
  // Two separate facts: whether slots pair with the words, and whether the
  // reader wants IPA at all. With IPA hidden the word units stay (lookups
  // work regardless of the toggle) — they just carry no transcription. The
  // shared walk runs once; the flat-line fallback keys off the pairing.
  const { paired, segments } = segmentOriginal(
    block.originalText,
    block.ipaSlots
  );
  return (
    <div className="sentence-block" data-position={block.position}>
      <p className="original-line">
        <WordSegments segments={segments} showSlots={showIpa && paired} />
      </p>
      {showIpa && !paired ? (
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

export const ReadingView = memo(function ReadingView({
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
  // Keyboard reaches the same words: Enter/Space on a focused word span runs
  // the same lookup, anchored to the word's own box (audit 2026-10-23 — the
  // spans were mouse-only).
  const handleWordKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (!onWordClick) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    const word = target.closest("[data-word]")?.getAttribute("data-word");
    if (!word) return;
    event.preventDefault();
    const box = target.getBoundingClientRect();
    onWordClick({
      word,
      point: { x: box.left + box.width / 2, y: box.bottom },
    });
  };
  return (
    <section
      className="reading"
      aria-labelledby="chapter-title"
      onClick={handleWordClick}
      onKeyDown={handleWordKeyDown}
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
});
