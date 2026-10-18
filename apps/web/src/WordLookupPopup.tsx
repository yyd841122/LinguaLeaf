import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
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

// Keep in sync with .lookup-popup in style.css (18rem wide, 16rem tall at
// most): the anchoring clamps the popup inside the viewport with plain
// arithmetic so it never needs layout reads.
const POPUP_WIDTH_PX = 288;
const POPUP_MAX_HEIGHT_PX = 256;
const POPUP_MARGIN_PX = 8;
// Sit just below the click, nudged left so the pointer lands near the head.
const POPUP_VERTICAL_OFFSET_PX = 14;
const POPUP_HORIZONTAL_OFFSET_PX = 20;

function anchoredStyle(point: ClickPoint): CSSProperties {
  // Below ~19rem of viewport the CSS max-width shrinks the popup; the
  // clamp must assume the smaller width or the right edge would overshoot.
  const width = Math.min(
    POPUP_WIDTH_PX,
    window.innerWidth - 2 * POPUP_MARGIN_PX
  );
  const maxLeft = Math.max(
    POPUP_MARGIN_PX,
    window.innerWidth - width - POPUP_MARGIN_PX
  );
  const maxTop = Math.max(
    POPUP_MARGIN_PX,
    window.innerHeight - POPUP_MAX_HEIGHT_PX - POPUP_MARGIN_PX
  );
  return {
    left: Math.min(
      Math.max(point.x - POPUP_HORIZONTAL_OFFSET_PX, POPUP_MARGIN_PX),
      maxLeft
    ),
    top: Math.min(
      Math.max(point.y + POPUP_VERTICAL_OFFSET_PX, POPUP_MARGIN_PX),
      maxTop
    ),
  };
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
