import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { useOwner, useSettle } from "@lingualeaf/reading-model/react";
import type { ReviewNoteEntry } from "../../server/src/wire";
import { NOTE_TYPE_LABELS } from "./NotePanels";
import { fetchReviewNotes } from "./reviewNotes";

function groupEntries(entries: ReviewNoteEntry[]) {
  const books = new Map<
    number,
    {
      title: string;
      chapters: Map<number, { title: string; entries: ReviewNoteEntry[] }>;
    }
  >();
  for (const entry of entries) {
    let book = books.get(entry.bookId);
    if (!book) {
      book = { title: entry.bookTitle, chapters: new Map() };
      books.set(entry.bookId, book);
    }
    let chapter = book.chapters.get(entry.chapterPosition);
    if (!chapter) {
      chapter = { title: entry.chapterTitle, entries: [] };
      book.chapters.set(entry.chapterPosition, chapter);
    }
    chapter.entries.push(entry);
  }
  return books;
}

function ReviewNote({ entry }: { entry: ReviewNoteEntry }) {
  const { note, bookId } = entry;
  const [expanded, setExpanded] = useState(false);
  const [canExpand, setCanExpand] = useState(false);
  const textRef = useRef<HTMLParagraphElement>(null);
  const textId = useId();
  // Measure the rendered clamp, including narrow viewports and short text
  // with many newlines. A character cutoff cannot predict actual overflow.
  useLayoutEffect(() => {
    if (expanded) return;
    const text = textRef.current;
    if (!text) return;
    const measure = () => setCanExpand(text.scrollHeight > text.clientHeight);
    measure();
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(measure);
      observer.observe(text);
      return () => observer.disconnect();
    }
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [expanded, note.text]);
  const target =
    note.chapter === null || note.block === null
      ? `/book/${bookId}/1`
      : `/book/${bookId}/${note.chapter}?block=${note.block}&note=${note.id}`;
  return (
    <li className="review-note">
      <Link to={target} className="review-note-link">
        <span className="note-badge" data-note-type={note.type}>
          {NOTE_TYPE_LABELS[note.type]}
        </span>
        <p
          id={textId}
          ref={textRef}
          className={`review-note-text${expanded ? "" : " is-collapsed"}`}
        >
          {note.text}
        </p>
      </Link>
      {canExpand && (
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={textId}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? "收起" : "展开"}
        </button>
      )}
    </li>
  );
}

export function ReviewPage() {
  const [entries, setEntries] = useState<ReviewNoteEntry[] | null>(null);
  const owner = useOwner();
  const { failed, run } = useSettle(owner);
  useEffect(() => {
    owner.invalidate();
    void run(fetchReviewNotes(), { onFresh: setEntries });
    return () => owner.invalidate();
  }, [owner, run]);
  return (
    <main className="review-page">
      <Link to="/">← 回书架</Link>
      <h1>笔记复习</h1>
      {failed ? (
        <p role="alert" className="error">
          笔记加载失败，请刷新重试。
        </p>
      ) : entries === null ? (
        <p>加载中…</p>
      ) : entries.length === 0 ? (
        <p>还没有笔记；阅读时点句尾的 ✎ 落一条。</p>
      ) : (
        [...groupEntries(entries)].map(([bookId, book]) => (
          <section
            key={bookId}
            className="review-book"
            aria-labelledby={`review-book-${bookId}`}
          >
            <h2 id={`review-book-${bookId}`}>{book.title}</h2>
            {[...book.chapters].map(([position, chapter]) => (
              <section
                key={position}
                aria-labelledby={`review-chapter-${bookId}-${position}`}
              >
                <h3 id={`review-chapter-${bookId}-${position}`}>
                  {chapter.title}
                </h3>
                <ul className="review-notes">
                  {chapter.entries.map((entry) => (
                    <ReviewNote key={entry.note.id} entry={entry} />
                  ))}
                </ul>
              </section>
            ))}
          </section>
        ))
      )}
    </main>
  );
}
