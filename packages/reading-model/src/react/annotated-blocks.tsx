import type { KeyboardEvent, MouseEvent, ReactNode } from "react";
import { segmentOriginal, type Segment } from "../sentence-segments.js";
import type { WordStatus } from "../word-lookup.js";
import type { WordClick } from "./WordLookupPopup.js";
import { wordFromEvent } from "./wordFromEvent.js";

export type AnnotatedBlock = (
  | {
      kind: "sentence";
      text: string;
      ipaSlots: string[] | null;
      // undefined omits a row; null preserves an empty annotation row.
      ipaText?: string | null;
      translationText?: string | null;
    }
  | { kind: "code" | "raw" | "image"; text: string }
) & { position?: number };

// The index is sentence-local, zero-based, and counts only word segments.
export type StatusReader = (word: string, index: number) => WordStatus | null;

function WordSegments({
  segments,
  showSlots,
  statusOf,
}: {
  segments: Segment[];
  showSlots: boolean;
  statusOf: StatusReader;
}) {
  const nodes: ReactNode[] = [];
  let index = 0;
  for (const segment of segments) {
    if (segment.kind === "text") {
      nodes.push(segment.text);
      continue;
    }
    const ipa = showSlots ? segment.ipa : undefined;
    const status = statusOf(segment.word, index);
    const settled = status === "known" || status === "ignored";
    nodes.push(
      ipa ? (
        <span
          className={settled ? "ipa-word word-settled" : "ipa-word"}
          data-word={segment.word}
          key={index}
          role="button"
          tabIndex={0}
        >
          <span className="ipa-word-text">{segment.word}</span>
          {/* ::before paints data-ipa without adding IPA to copied text. */}
          <span className="ipa-word-ipa" data-ipa={ipa} />
        </span>
      ) : (
        <span
          className={settled ? "lookup-word word-settled" : "lookup-word"}
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

export function AnnotatedBlockView({
  block,
  statusOf,
  showIpa,
  showTranslation,
}: {
  block: AnnotatedBlock;
  statusOf: StatusReader;
  showIpa: boolean;
  showTranslation: boolean;
}) {
  if (block.kind === "sentence") {
    const { paired, segments } = segmentOriginal(block.text, block.ipaSlots);
    return (
      <div className="sentence-block" data-position={block.position}>
        <p className="original-line">
          <WordSegments
            segments={segments}
            showSlots={showIpa && paired}
            statusOf={statusOf}
          />
        </p>
        {showIpa && !paired && block.ipaText !== undefined ? (
          <p className="ipa-line">{block.ipaText ?? ""}</p>
        ) : null}
        {showTranslation && block.translationText !== undefined ? (
          <p className="translation-line">{block.translationText ?? ""}</p>
        ) : null}
      </div>
    );
  }
  if (block.kind === "code") {
    return (
      <pre className="code-block" data-position={block.position}>
        <code>{block.text}</code>
      </pre>
    );
  }
  if (block.kind === "image") {
    return (
      <figure className="image-block" data-position={block.position}>
        <span className="image-placeholder" aria-hidden="true">
          🖼
        </span>
        {block.text ? <figcaption>{block.text}</figcaption> : null}
      </figure>
    );
  }
  return (
    <p className="raw-block" data-position={block.position}>
      {block.text}
    </p>
  );
}

/** Attach to the host's chapter section only when it supplies a callback. */
export function createWordHandlers(onWordClick: (click: WordClick) => void) {
  return {
    onClick(event: MouseEvent<HTMLElement>) {
      const word = wordFromEvent(event);
      if (word) {
        onWordClick({ word, point: { x: event.clientX, y: event.clientY } });
      }
    },
    onKeyDown(event: KeyboardEvent<HTMLElement>) {
      if (event.key !== "Enter" && event.key !== " ") return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const word = wordFromEvent(event);
      if (!word) return;
      event.preventDefault();
      // Preserve the actual target's box, including nested word children.
      const box = target.getBoundingClientRect();
      onWordClick({
        word,
        point: { x: box.left + box.width / 2, y: box.bottom },
      });
    },
  };
}
