import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { anchorPopup, speakWord } from "@lingualeaf/reading-model";
import type { ClickPoint } from "@lingualeaf/reading-model";
import type {
  LookupWithState,
  VocabularyStore,
  VocabState,
} from "../store/vocabulary-store";
import { useOwner } from "../lib/use-owner";

// The 生词本 state the popup manages (ADR-0005): the three buttons are the
// whole operation set — any state from any other state, no hidden matrix.
// Record-typed so a state without copy is a compile error. Copy speaks the
// glossary (学习中/已掌握/已忽略).
const WORD_STATUS_LABELS: Record<VocabState, string> = {
  learning: "学习中",
  known: "已掌握",
  ignored: "已忽略",
};
const WORD_STATUSES = Object.keys(WORD_STATUS_LABELS) as VocabState[];

// Fetch phases: loading → found | missing (no dictionary entry) | error.
// Missing and error are distinct because they read differently to a reader
// ("词库里没有" vs "查询没成功").
type LookupState =
  | { phase: "loading" }
  | { phase: "found"; lookup: LookupWithState }
  | { phase: "missing" }
  | { phase: "error" };

// States key on the lemma — the same key the lookup wrote through the
// store's stateKey (lemma ?? folded form).
const statusKey = (lookup: LookupWithState) => lookup.lemma ?? lookup.word;

// The popup's box constants and the clamp math are the reading model's;
// the .lookup-* stylesheet comes from the shared annotated sheet.
function anchoredStyle(point: ClickPoint): CSSProperties {
  return anchorPopup(point, {
    width: window.innerWidth,
    height: window.innerHeight,
  });
}

// The word-lookup popup (GLOSSARY: 点词查详情): a small floating card
// anchored to the clicked word. No backdrop, no scroll lock — closing it
// returns the reader to exactly where they were. Store-fed, not
// fetch-fed: the injected VocabularyStore carries 查词即状态, so a found
// word arrives with its concrete state already applied.
export function WordLookupPopup({
  click,
  store,
  onClose,
  onStatusApplied,
}: {
  click: { word: string; point: ClickPoint };
  store: VocabularyStore;
  onClose: () => void;
  onStatusApplied: (applied: {
    word: string;
    lemma: string | null;
    status: VocabState;
  }) => void;
}) {
  const { word, point } = click;
  const [state, setState] = useState<LookupState>({ phase: "loading" });
  // A save failure belongs to the word it was attempted for: clicking
  // another word restarts the popup's story, and the old notice must not
  // outlive it (CODING_STANDARDS, credibility).
  const [saveFailed, setSaveFailed] = useState(false);
  // In-flight saves follow their own write, not the word change: markers
  // key by statusKey and live exactly as long as that write (per-entity
  // async UI state keys by entity). A word revisited while its write is
  // still in flight shows its row disabled until the write lands — the
  // owner token's key-comparison revival rule.
  const [savingKeys, setSavingKeys] = useState<Set<string>>(new Set());
  const owner = useOwner(word);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    setState({ phase: "loading" });
    setSaveFailed(false);
    store
      .lookup(word)
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
  }, [word, store]);

  // The popup's status operation: an idempotent set, the shown state
  // patched when it lands. A failed save leaves the previous state shown
  // beside a notice; the next attempt clears it.
  const applyStatus = (status: VocabState) => {
    if (state.phase !== "found") return;
    const key = statusKey(state.lookup);
    if (savingKeys.has(key)) return;
    setSaveFailed(false);
    setSavingKeys((keys) => new Set(keys).add(key));
    const applied = {
      word: state.lookup.word,
      lemma: state.lookup.lemma,
      status,
    };
    const ticket = owner.mark();
    store
      .setStatus(key, status)
      .then(() => {
        // The saved fact belongs to the word even after the popup moves.
        onStatusApplied(applied);
        // A click since this write started moved the popup to another
        // word: the stale verdict must not patch it.
        if (ticket.stale()) return;
        setState((current) =>
          current.phase === "found"
            ? { ...current, lookup: { ...current.lookup, status } }
            : current
        );
      })
      .catch(() => {
        // Nor does a failed attempt's notice follow the reader to the
        // next word.
        if (!ticket.stale()) setSaveFailed(true);
      })
      .finally(() =>
        setSavingKeys((keys) => {
          const next = new Set(keys);
          next.delete(key);
          return next;
        })
      );
  };

  // Dismiss on Escape, on scroll/resize (the anchor goes stale the moment
  // the page moves under the popup), or on any click that is neither
  // inside the popup nor on a word — clicking another word moves it.
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
            className="lookup-head-button"
            aria-label="发音"
            onClick={() => speakWord(word)}
          >
            🔊
          </button>
          <button
            type="button"
            className="lookup-head-button"
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
          {/* 词元回退披露 (spec story 6): a lemma-sourced transcription is
              named as such — the lemma's reading never poses as the
              surface form's own. */}
          {state.lookup.ipa && state.lookup.ipaSource === "lemma" ? (
            <p className="lookup-status">
              音标为原形 {state.lookup.lemma} 的读音。
            </p>
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
                disabled={savingKeys.has(statusKey(state.lookup))}
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
