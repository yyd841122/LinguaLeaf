import { useState } from "react";
import { isInteractiveTarget, selectionActive } from "./tapZones";

// The summonable menu's shared state machine (redesign 02): hidden while
// reading, bars on a background tap, one panel at a time. Both faces own
// their own panel NAMES (strings); the machine is identical — extracted
// before a third face copies it (the dual-axis review's call).
export function useReaderMenu(): {
  menuOpen: boolean;
  panel: string | null;
  openPanel: (next: string) => void;
  closePanel: () => void;
  // 点按分区 (spec review finding 13): a tap on the reading surface
  // summons or dismisses the menu — but only a BACKGROUND tap. Words,
  // pens and controls win; an active selection is the reader's; and
  // while a panel is up its veil owns every tap.
  onSurfaceTap: (event: React.MouseEvent<HTMLElement>) => void;
  // 选择文字期间禁翻 (same finding): an active selection swallows the
  // flip — the reader is mid-gesture, not navigating.
  flipGuard: (flip: () => void) => () => void;
} {
  const [menuOpen, setMenuOpen] = useState(false);
  const [panel, setPanel] = useState<string | null>(null);
  const openPanel = (next: string) => {
    setMenuOpen(false);
    setPanel(next);
  };
  const closePanel = () => setPanel(null);
  const onSurfaceTap = (event: React.MouseEvent<HTMLElement>) => {
    if (panel !== null) return;
    if (isInteractiveTarget(event.target)) return;
    if (selectionActive()) return;
    setMenuOpen((open) => !open);
  };
  const flipGuard = (flip: () => void) => () => {
    if (selectionActive()) return;
    flip();
  };
  return { menuOpen, panel, openPanel, closePanel, onSurfaceTap, flipGuard };
}
