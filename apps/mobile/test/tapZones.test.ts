import { describe, expect, it } from "vitest";
import { isInteractiveTarget, selectionActive } from "../src/reader/tapZones";

// 点按优先级 (redesign 02, spec review finding 13): 词 / 笔钮 / 弹窗
// controls beat the menu's background tap. The summon filter is a pure
// predicate over the event target — anything interactive (or inside it)
// must NOT summon or dismiss the menu.

describe("isInteractiveTarget", () => {
  it("words, pens and controls are interactive — however deep they nest", () => {
    document.body.innerHTML = `
      <div id="host">
        <span class="lookup-word">go</span>
        <span class="ipa-word">go</span>
        <button>目录</button>
        <a href="#">x</a>
        <span class="block-note-button">✎</span>
        <span class="pdf-word">w</span>
        <p><em><span class="lookup-word">deep</span></em></p>
      </div>`;
    const host = document.getElementById("host")!;
    for (const el of [
      ...host.querySelectorAll(
        ".lookup-word, .ipa-word, button, a, .block-note-button, .pdf-word"
      ),
    ]) {
      expect(isInteractiveTarget(el), el.className || el.tagName).toBe(true);
    }
    // An element INSIDE an interactive ancestor counts too.
    expect(isInteractiveTarget(host.querySelector("em span")!)).toBe(true);
  });

  it("plain text and blocks are background — the summon case", () => {
    document.body.innerHTML = `
      <div class="sentence-block"><p class="original-line">plain words</p></div>`;
    const line = document.querySelector(".original-line")!;
    expect(isInteractiveTarget(line)).toBe(false);
    expect(isInteractiveTarget(line.firstChild)).toBe(false);
    expect(isInteractiveTarget(null)).toBe(false);
  });
});

describe("selectionActive", () => {
  it("a collapsed or absent selection is not active — an active range is", () => {
    expect(selectionActive()).toBe(false);
    const range = document.createRange();
    range.selectNodeContents(document.body);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    expect(selectionActive()).toBe(true);
    selection.removeAllRanges();
    expect(selectionActive()).toBe(false);
  });
});
