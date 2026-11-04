import {
  AnnotatedBlockView,
  createWordHandlers,
  type WordClick,
  type BlockNoteControl,
} from "@lingualeaf/reading-model/react";
import { memo } from "react";
import type { BlockPayload, ChapterPayload } from "../../server/src/wire";

export type Block = BlockPayload;

export type { ClickPoint } from "@lingualeaf/reading-model";
export type { WordClick } from "@lingualeaf/reading-model/react";

export const ReadingView = memo(function ReadingView({
  chapter,
  ipaSize,
  originalSize,
  translationSize,
  showIpa = true,
  showTranslation = true,
  onWordClick,
  noteControl,
}: {
  chapter: Pick<ChapterPayload, "position" | "title" | "blocks">;
  ipaSize?: number;
  originalSize?: number;
  translationSize?: number;
  showIpa?: boolean;
  showTranslation?: boolean;
  onWordClick?: (click: WordClick) => void;
  noteControl?: (position: number) => BlockNoteControl;
}) {
  const wordHandlers = onWordClick ? createWordHandlers(onWordClick) : {};
  return (
    <section
      className="reading"
      aria-labelledby="chapter-title"
      {...wordHandlers}
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
          <AnnotatedBlockView
            key={block.position}
            block={
              block.kind === "sentence"
                ? {
                    kind: block.kind,
                    position: block.position,
                    text: block.originalText,
                    ipaSlots: block.ipaSlots,
                    ipaText: block.ipaText,
                    translationText: block.translationText,
                  }
                : {
                    kind: block.kind,
                    position: block.position,
                    text: block.originalText,
                  }
            }
            statusOf={(_word, index) =>
              block.kind === "sentence"
                ? (block.wordStatuses[index] ?? null)
                : null
            }
            showIpa={showIpa}
            showTranslation={showTranslation}
            note={noteControl?.(block.position)}
          />
        ))}
      </div>
    </section>
  );
});
