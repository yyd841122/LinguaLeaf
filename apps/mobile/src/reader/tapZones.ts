// 点按分区 (redesign 02, spec review finding 13): while the menu is
// hidden, a tap on the reading surface either summons the menu (a
// BACKGROUND tap) or belongs to whatever interactive thing it landed
// on — words, note pens, buttons, popups always win. The two edge
// strips (翻章 / 翻页) are separate inert elements over the margin
// bands, so they never compete with text. Drag / long-press guards:
// a real drag never fires click, and a long-press that opened a
// selection is filtered here — selectionCollapsed is the summon's
// gate, an active selection is the reader's, not the menu's.

// Anything that owns its own tap behavior, or an ancestor of it. The
// list is the reading faces' whole interactive vocabulary — extend it
// with the faces, not ad hoc at call sites.
const INTERACTIVE_SELECTOR = [
  "button",
  "a",
  "input",
  "textarea",
  "select",
  "[role='button']",
  ".lookup-word",
  ".ipa-word",
  ".block-note-button",
  ".pdf-word",
  ".pdf-note-button",
].join(",");

export function isInteractiveTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element && target.closest(INTERACTIVE_SELECTOR) !== null
  );
}

export function selectionActive(): boolean {
  const selection = window.getSelection();
  return selection !== null && !selection.isCollapsed;
}
