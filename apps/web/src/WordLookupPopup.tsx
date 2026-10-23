import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { anchorPopup } from "@lingualeaf/reading-model";
import { fetchWordLookup, speakWord, type WordLookup } from "./wordLookup";
import type { ClickPoint, WordClick } from "./ReadingView";

// Fetch phases: loading → found | missing (dictionary has no such word) |
// error (the lookup itself failed). Missing and error are distinct because
// they read differently to a reader ("词库里没有" vs "查询没成功").
type LookupState =
  | { phase: "loading" }
  | { phase: "found"; lookup: WordLookup }
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
}: {
  click: WordClick;
  onClose: () => void;
}) {
  const { word, point } = click;
  const [state, setState] = useState<LookupState>({ phase: "loading" });
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    setState({ phase: "loading" });
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
        </>
      ) : null}
    </div>
  );
}
