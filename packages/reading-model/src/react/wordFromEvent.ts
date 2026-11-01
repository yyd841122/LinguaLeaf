// Shared delegation for chapter text and PDF overlays. Both native events
// and React synthetic events supply this target shape; punctuation and
// annotation lines without a data-word ancestor remain inert.
export function wordFromEvent(event: {
  target: EventTarget | null;
}): string | null {
  const target = event.target;
  if (!(target instanceof Element)) return null;
  return target.closest("[data-word]")?.getAttribute("data-word") || null;
}
