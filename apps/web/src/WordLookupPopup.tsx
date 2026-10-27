import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { anchorPopup } from "@lingualeaf/reading-model";
import type { WordStatus } from "../../server/src/wire";
import {
  fetchWordLookup,
  putWordStatus,
  speakWord,
  type WordLookupResponse,
} from "./wordLookup";
import type { ClickPoint, WordClick } from "./ReadingView";

// The 生词本 state the popup manages (ADR-0005): the three buttons are the
// whole operation set — any state from any other state, no hidden matrix.
// Record-typed so a wire member without copy is a compile error.
const WORD_STATUS_LABELS: Record<WordStatus, string> = {
  learning: "学习中",
  known: "已掌握",
  ignored: "已忽略",
};
const WORD_STATUSES = Object.keys(WORD_STATUS_LABELS) as WordStatus[];

// Fetch phases: loading → found | missing (dictionary has no such word) |
// error (the lookup itself failed). Missing and error are distinct because
// they read differently to a reader ("词库里没有" vs "查询没成功").
type LookupState =
  | { phase: "loading" }
  | { phase: "found"; lookup: WordLookupResponse }
  | { phase: "missing" }
  | { phase: "error" };

// The popup's box constants and the clamp math are the reading model's
// (packages/reading-model, popup-anchor); the .lookup-* stylesheet in
// style.css mirrors the box by hand. The anchoring clamps the popup inside
// the viewport with plain arithmetic so it never needs layout reads.
function anchoredStyle(point: ClickPoint): CSSProperties {
  return anchorPopup(point, {
    width: window.innerWidth,
    height: window.innerHeight,
  });
}

// The word-lookup popup (ticket 06): a small floating card anchored to the
// clicked word. No backdrop, no scroll lock — closing it must return the
// reader to exactly where they were.
export function WordLookupPopup({
  click,
  onClose,
  onStatusApplied,
}: {
  click: WordClick;
  onClose: () => void;
  onStatusApplied: (applied: {
    word: string;
    lemma: string | null;
    status: WordStatus;
  }) => void;
}) {
  const { word, point } = click;
  const [state, setState] = useState<LookupState>({ phase: "loading" });
  // A save failure belongs to the word it was attempted for: clicking
  // another word restarts the popup's story, and the old notice must not
  // outlive it (CODING_STANDARDS, credibility). The in-flight fact follows
  // the same rule — both reset when the word changes.
  const [saveFailed, setSaveFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  // The word this popup currently shows, readable from async callbacks
  // (the render-time adjust idiom — the closures below capture stale words).
  const currentWordRef = useRef(word);
  currentWordRef.current = word;
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    setState({ phase: "loading" });
    setSaveFailed(false);
    setSaving(false);
    fetchWordLookup(word)
      .then((lookup) => {
        if (cancelled) return;
        setState(lookup ? { phase: "found", lookup } : { phase: "missing" });
      })
      .catch(() => {
        if (!cancelled) setState({ phase: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [word]);

  // The popup's status operation: an idempotent PUT, the shown state
  // patched when it lands. A failed save leaves the previous state shown
  // beside a notice — the last rendered state must not outlive its
  // credibility (CODING_STANDARDS), and the next attempt clears it.
  const applyStatus = (status: WordStatus) => {
    if (state.phase !== "found" || saving) return;
    setSaveFailed(false);
    setSaving(true);
    // States key on the lemma — the same key the lookup wrote server-side.
    const key = state.lookup.lemma ?? state.lookup.word;
    const applied = {
      word: state.lookup.word,
      lemma: state.lookup.lemma,
      status,
    };
    const wordAtClick = state.lookup.word;
    const stale = () => currentWordRef.current !== wordAtClick;
    putWordStatus(key, status)
      .then(() => {
        // The saved fact belongs to the word even after the popup moves
        // (popup-status-backedge spec, decision 3).
        onStatusApplied(applied);
        // A click since this PUT started moved the popup to another word:
        // the stale verdict must not patch it (the reading page's rule for
        // a navigation's stale trigger response).
        if (stale()) return;
        setState((current) =>
          current.phase === "found"
            ? { ...current, lookup: { ...current.lookup, status } }
            : current
        );
      })
      .catch(() => {
        // Nor does a failed attempt's notice follow the reader to the
        // next word.
        if (!stale()) setSaveFailed(true);
      })
      .finally(() => setSaving(false));
  };

  // Dismiss on Escape, on scroll/resize (the anchor goes stale the moment
  // the page moves under the popup — moving on is the dismissal), or on any
  // click that is neither inside the popup nor on a word — clicking another
  // word moves the popup instead of closing it.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const onGone = () => onClose();
    const onClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (rootRef.current?.contains(target)) return;
      if (target.closest("[data-word]")) return;
      onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("click", onClick);
    window.addEventListener("scroll", onGone);
    window.addEventListener("resize", onGone);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("click", onClick);
      window.removeEventListener("scroll", onGone);
      window.removeEventListener("resize", onGone);
    };
  }, [onClose]);

  return (
    <div
      ref={rootRef}
      className="lookup-popup"
      role="dialog"
      aria-label={`词详情：${word}`}
      style={anchoredStyle(point)}
    >
      <div className="lookup-head">
        <span className="lookup-head-word">{word}</span>
        {state.phase === "found" &&
        state.lookup.lemma &&
        state.lookup.lemma !== state.lookup.word ? (
          <span className="lookup-lemma">原形 {state.lookup.lemma}</span>
        ) : null}
        <span className="lookup-head-actions">
          <button
            type="button"
            className="lookup-speak"
            aria-label="发音"
            onClick={() => speakWord(word)}
          >
            🔊
          </button>
          <button
            type="button"
            className="lookup-close"
            aria-label="关闭"
            onClick={onClose}
          >
            ✕
          </button>
        </span>
      </div>
      {state.phase === "loading" ? (
        <p className="lookup-status">查询中…</p>
      ) : null}
      {state.phase === "missing" ? (
        <p className="lookup-status">词库中未收录这个词。</p>
      ) : null}
      {state.phase === "error" ? (
        <p className="lookup-status">查询失败，请稍后再试。</p>
      ) : null}
      {state.phase === "found" ? (
        <>
          {state.lookup.ipa ? (
            <p className="lookup-ipa">/{state.lookup.ipa}/</p>
          ) : null}
          {state.lookup.pos ? (
            <p className="lookup-pos">{state.lookup.pos}</p>
          ) : null}
          {state.lookup.translation ? (
            <p className="lookup-translation">{state.lookup.translation}</p>
          ) : null}
          <div className="lookup-vocab" role="group" aria-label="生词本状态">
            <span className="lookup-vocab-label">生词本</span>
            {WORD_STATUSES.map((status) => (
              <button
                key={status}
                type="button"
                className="lookup-vocab-option"
                aria-pressed={state.lookup.status === status}
                disabled={saving}
                onClick={() => applyStatus(status)}
              >
                {WORD_STATUS_LABELS[status]}
              </button>
            ))}
          </div>
          {saveFailed ? (
            <p className="lookup-status" role="status">
              状态保存失败，请重试。
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
