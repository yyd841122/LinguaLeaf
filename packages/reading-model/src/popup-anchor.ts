// Where the word-lookup popup anchors: plain arithmetic on the click point,
// no layout reads. The constants are the popup's box in px — the CSS sides
// mirror them (the web stylesheet by hand, the export stylesheet by
// interpolation), but the clamp math below is the one behavior.
export const POPUP_WIDTH_PX = 288;
export const POPUP_MAX_HEIGHT_PX = 256;
export const POPUP_MARGIN_PX = 8;
// Sit just below the click, nudged left so the pointer lands near the head.
export const POPUP_VERTICAL_OFFSET_PX = 14;
export const POPUP_HORIZONTAL_OFFSET_PX = 20;

export type ClickPoint = { x: number; y: number };
export type Viewport = { width: number; height: number };

// The popup's clamped top-left corner. Below ~19rem of viewport the CSS
// max-width shrinks the popup; the clamp must assume the smaller width or
// the right edge would overshoot.
export function anchorPopup(
  point: ClickPoint,
  viewport: Viewport
): { left: number; top: number } {
  const width = Math.min(POPUP_WIDTH_PX, viewport.width - 2 * POPUP_MARGIN_PX);
  const maxLeft = Math.max(
    POPUP_MARGIN_PX,
    viewport.width - width - POPUP_MARGIN_PX
  );
  const maxTop = Math.max(
    POPUP_MARGIN_PX,
    viewport.height - POPUP_MAX_HEIGHT_PX - POPUP_MARGIN_PX
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
