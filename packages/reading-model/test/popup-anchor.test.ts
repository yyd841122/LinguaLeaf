import { describe, expect, it } from "vitest";
import {
  POPUP_MARGIN_PX,
  POPUP_MAX_HEIGHT_PX,
  POPUP_VERTICAL_OFFSET_PX,
  POPUP_WIDTH_PX,
  anchorPopup,
} from "../src/popup-anchor.js";

const DESKTOP = { width: 1024, height: 768 };

describe("anchorPopup", () => {
  it("sits the popup just below the click, nudged left of the pointer", () => {
    expect(anchorPopup({ x: 100, y: 100 }, DESKTOP)).toEqual({
      left: 80,
      top: 114,
    });
  });

  it("clamps the right and bottom edges inside the viewport", () => {
    const anchored = anchorPopup({ x: 1020, y: 760 }, DESKTOP);
    expect(anchored.left).toBe(1024 - POPUP_WIDTH_PX - POPUP_MARGIN_PX);
    expect(anchored.top).toBe(768 - POPUP_MAX_HEIGHT_PX - POPUP_MARGIN_PX);
  });

  it("clamps the left edge, and the vertical offset rides before the clamp", () => {
    // x clamps to the margin; y sits at click + offset (the offset only
    // ever pushes down, so a corner click never rises to the margin).
    expect(anchorPopup({ x: 0, y: 0 }, DESKTOP)).toEqual({
      left: POPUP_MARGIN_PX,
      top: POPUP_VERTICAL_OFFSET_PX,
    });
  });

  it("assumes the shrunken width on narrow viewports so the right edge holds", () => {
    // Below ~19rem the CSS max-width shrinks the popup; the clamp must
    // assume the smaller width (viewport minus both margins) or the right
    // edge would overshoot.
    const narrow = anchorPopup({ x: 300, y: 100 }, { width: 260, height: 600 });
    expect(narrow.left).toBe(POPUP_MARGIN_PX);
  });
});
