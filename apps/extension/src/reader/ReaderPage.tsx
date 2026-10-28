import { useRef, useState } from "react";
import type { ChangeEvent, DragEvent } from "react";
import {
  IMPORT_ERROR_COPY,
  importBookFromFile,
  type ExtBook,
} from "./import-book";
import type { ExtBlock } from "./import-book";
import { UploadRejected } from "@lingualeaf/import-core";
import "./reader.css";

// The reader page's whole story: empty (choose or drop a file) → importing
// → reading, with errors as a phase that keeps the entry usable. No
// persistence yet (tickets 04/05 introduce the storage seam) — a closed
// tab forgets the book, and re-entry starts at the file picker.
type ReaderState =
  | { phase: "empty" }
  | { phase: "importing" }
  | { phase: "error"; copy: string }
  | { phase: "reading"; book: ExtBook; chapterIndex: number };

function copyFor(error: unknown): string {
  if (error instanceof UploadRejected) {
    const copy = IMPORT_ERROR_COPY[error.reason];
    if (copy) return copy;
  }
  // An unexpected failure must not masquerade as a broken file
  // (CODING_STANDARDS: missing and failed read differently to a reader).
  return "导入失败：出了点意外，请重试。";
}

function BlockView({ block }: { block: ExtBlock }) {
  if (block.kind === "sentence") {
    return (
      <p className="reader-sentence" data-kind="sentence">
        {block.text}
      </p>
    );
  }
  if (block.kind === "code") {
    return (
      <pre className="reader-code" data-kind="code">
        <code>{block.text}</code>
      </pre>
    );
  }
  if (block.kind === "image") {
    return (
      <figure className="reader-image" data-kind="image">
        <span className="reader-image-placeholder" aria-hidden="true">
          🖼
        </span>
        {block.text ? <figcaption>{block.text}</figcaption> : null}
      </figure>
    );
  }
  return (
    <p className="reader-raw" data-kind="raw">
      {block.text}
    </p>
  );
}

export function ReaderPage() {
  const [state, setState] = useState<ReaderState>({ phase: "empty" });
  const dropDepth = useRef(0);

  const handleFile = async (file: File | undefined | null) => {
    if (!file || state.phase === "importing") return;
    setState({ phase: "importing" });
    try {
      const book = await importBookFromFile(file);
      setState({ phase: "reading", book, chapterIndex: 0 });
    } catch (error) {
      setState({ phase: "error", copy: copyFor(error) });
    }
  };

  const onPick = (event: ChangeEvent<HTMLInputElement>) => {
    void handleFile(event.target.files?.[0]);
    event.target.value = "";
  };

  // Dragover must be cancelled for drop to fire; dragenter/leave counting
  // keeps the highlight from flickering across child elements.
  const onDragEnter = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    dropDepth.current += 1;
  };
  const onDragLeave = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    dropDepth.current = Math.max(0, dropDepth.current - 1);
  };
  const onDragOver = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
  };
  const onDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    dropDepth.current = 0;
    void handleFile(event.dataTransfer.files?.[0]);
  };

  if (state.phase === "reading") {
    const { book, chapterIndex } = state;
    const chapter = book.chapters[chapterIndex];
    const goChapter = (index: number) => {
      if (index >= 0 && index < book.chapters.length) {
        setState({ ...state, chapterIndex: index });
      }
    };
    return (
      <main className="reader" aria-label="扩展阅读页">
        <header className="reader-head">
          <h1 className="reader-title">{book.title}</h1>
          <button
            type="button"
            className="reader-reopen"
            onClick={() => setState({ phase: "empty" })}
          >
            打开其他文件
          </button>
        </header>
        <nav className="reader-toc" aria-label="目录">
          <ol>
            {book.chapters.map((entry, index) => (
              <li key={index}>
                <button
                  type="button"
                  aria-current={index === chapterIndex ? "true" : undefined}
                  onClick={() => goChapter(index)}
                >
                  {entry.title}
                </button>
              </li>
            ))}
          </ol>
        </nav>
        {chapter ? (
          <section className="reader-chapter" aria-label={chapter.title}>
            <h2>{chapter.title}</h2>
            <div className="reader-blocks">
              {chapter.blocks.map((block, index) => (
                <BlockView key={index} block={block} />
              ))}
            </div>
          </section>
        ) : null}
        <footer className="reader-pager">
          <button
            type="button"
            disabled={chapterIndex === 0}
            onClick={() => goChapter(chapterIndex - 1)}
          >
            上一章
          </button>
          <span className="reader-position">
            {chapterIndex + 1} / {book.chapters.length}
          </span>
          <button
            type="button"
            disabled={chapterIndex === book.chapters.length - 1}
            onClick={() => goChapter(chapterIndex + 1)}
          >
            下一章
          </button>
        </footer>
      </main>
    );
  }

  return (
    <main
      className="reader reader-entry"
      aria-label="扩展阅读页"
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <h1 className="reader-title">LinguaLeaf</h1>
      {state.phase === "importing" ? (
        <p className="reader-status" role="status">
          导入中…
        </p>
      ) : null}
      {state.phase === "error" ? (
        <p className="reader-error" role="alert">
          {state.copy}
        </p>
      ) : null}
      <label className="reader-picker">
        <span>选择一个 EPUB 文件，或把它拖进本页。</span>
        <input
          type="file"
          accept=".epub"
          aria-label="选择 EPUB 文件"
          onChange={onPick}
        />
      </label>
      <p className="reader-hint">
        标注在浏览器本地完成：无网络、无服务进程。加密或损坏的档案无法导入。
      </p>
    </main>
  );
}
