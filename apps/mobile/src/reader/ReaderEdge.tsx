import { useRef } from "react";
import { selectionActive } from "./tapZones";

// The edge flip strip (redesign 02): an invisible band over the margin
// gutter — EPUB flips chapters, PDF flips physical pages (ADR-0009's
// revision). Width rides --reader-margin wherever the face sets it.
//
// Gesture cancelling (spec review finding 13, the Codex review's
// Medium): a browser fires click after MOST gestures, but not even that
// can be assumed on an empty band — a long-press or a drag past the
// threshold is a gesture, not a flip, and a pointercancel obviously is.
// The press is tracked from pointerdown; any of those marks it
// cancelled and the click dies.
const LONG_PRESS_MS = 500;
const DRIFT_PX = 12;

export function ReaderEdge({
  side,
  label,
  disabled,
  onFlip,
}: {
  side: "left" | "right";
  label: string;
  disabled: boolean;
  onFlip: () => void;
}) {
  const press = useRef<{
    at: number;
    x: number;
    y: number;
    cancelled: boolean;
  } | null>(null);
  return (
    <button
      type="button"
      className={`reader-edge reader-edge-${side}`}
      aria-label={label}
      disabled={disabled}
      onPointerDown={(event) => {
        press.current = {
          at: performance.now(),
          x: event.clientX,
          y: event.clientY,
          cancelled: false,
        };
      }}
      onPointerMove={(event) => {
        const held = press.current;
        if (
          held &&
          Math.hypot(event.clientX - held.x, event.clientY - held.y) > DRIFT_PX
        )
          held.cancelled = true;
      }}
      onPointerCancel={() => {
        if (press.current) press.current.cancelled = true;
      }}
      onPointerUp={() => {
        const held = press.current;
        if (held && performance.now() - held.at > LONG_PRESS_MS)
          held.cancelled = true;
      }}
      onClick={() => {
        // 选择文字期间禁翻 (same finding): an active selection is the
        // reader's, not the navigator's.
        if (selectionActive()) return;
        if (press.current?.cancelled) return;
        onFlip();
      }}
    />
  );
}
