export type SentenceBlock = {
  position: number;
  kind: "sentence";
  originalText: string;
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

// One sentence block = three lines (原文行/音标行/译文行). The annotation lines
// render as empty placeholders until the import pipeline fills them.
function SentenceBlockView({ block }: { block: SentenceBlock }) {
  return (
    <div className="sentence-block" data-position={block.position}>
      <p className="original-line">{block.originalText}</p>
      <p className="ipa-line">{block.ipaText ?? ""}</p>
      <p className="translation-line">{block.translationText ?? ""}</p>
    </div>
  );
}

function BlockView({ block }: { block: Block }) {
  if (block.kind === "sentence") {
    return <SentenceBlockView block={block} />;
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

export function ReadingView({ chapter }: { chapter: ChapterContent }) {
  return (
    <section className="reading" aria-labelledby="chapter-title">
      <h1 id="chapter-title">{chapter.title}</h1>
      <div className="blocks">
        {chapter.blocks.map((block) => (
          <BlockView key={block.position} block={block} />
        ))}
      </div>
    </section>
  );
}
