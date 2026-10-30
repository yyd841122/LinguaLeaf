// The annotated book file's application half (GLOSSARY: 显示开关, 点词查
// 详情, 发音): the two display toggles, the tap-word lookup popup, and the
// pronunciation button — compiled by apps/server/scripts/build-file-script.mjs
// into an IIFE string and inlined into the exported HTML. Never imported at
// runtime, deliberately absent from index.ts. The shared rules it wires (the
// lookup fold, the popup clamp, speech) are imports — the file's own code is
// only the wiring around them, and it typechecks and lints like any other
// source. es2017 target, so: no async, no generators. Every storage
// touch is guarded — file:// contexts (and hardened browsers) may throw on
// access, and the file must fall back to all-shown and keep working in-page
// regardless. No network, no fetches: the self-contained red line covers
// the script too.
import { normalizeLookupToken } from "./lookup-fold.js";
import { anchorPopup } from "./popup-anchor.js";
import { speakWord } from "./speak.js";
import type { WordLookup } from "./word-lookup.js";

function main(): void {
  "use strict";

  // -- 显示开关 --
  // Root classes on <body> drive the visibility CSS; the choice is
  // remembered per toggle in localStorage.
  const TOGGLES: ReadonlyArray<readonly [string, string]> = [
    ["toggle-ipa", "lingualeaf-export.show-ipa"],
    ["toggle-translation", "lingualeaf-export.show-translation"],
  ];
  function readFlag(key: string): string | null {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  }
  function writeFlag(key: string, value: string): void {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // In-page toggling keeps working; only the memory is lost.
    }
  }
  TOGGLES.forEach(([id, key]) => {
    const toggle = document.getElementById(id) as HTMLInputElement | null;
    if (!toggle) return;
    if (readFlag(key) === "0") toggle.checked = false;
    const apply = () => {
      document.body.classList.toggle(
        "hide-" + toggle.getAttribute("data-annotation"),
        !toggle.checked
      );
    };
    apply();
    toggle.addEventListener("change", () => {
      apply();
      writeFlag(key, toggle.checked ? "1" : "0");
    });
  });

  // -- 点词查详情 --
  // Words arrive pre-tokenized: every clickable word in the file was
  // wrapped at export time by the reading model's shared pattern
  // (WORD_PATTERN); this file needs no runtime copy because the wrapping
  // is baked into the markup. What the file does own is the vocabulary
  // channel below — the fold itself is the reading model's
  // normalizeLookupToken, the very function the exporter keyed the
  // vocabulary with.
  let VOCAB: Record<string, WordLookup | null> = {};
  try {
    const vocabNode = document.getElementById("annotated-vocab");
    VOCAB = JSON.parse(vocabNode?.textContent ?? "") as Record<
      string,
      WordLookup | null
    >;
  } catch {
    // A missing or corrupt vocabulary makes every popup report a miss;
    // reading and the toggles keep working.
  }
  function lookupEntry(key: string): WordLookup | null {
    if (key.length === 0) return null;
    // Own properties only: a miss on a word like "constructor" must read
    // as a miss, not inherit from Object.prototype.
    return Object.prototype.hasOwnProperty.call(VOCAB, key)
      ? (VOCAB[key] ?? null)
      : null;
  }

  const popupNode = document.getElementById("lookup-popup");
  if (!popupNode) return;
  // Re-bound with a non-null type so the hoisted helpers below see it
  // (narrowing does not flow into hoisted function declarations).
  const popup: HTMLElement = popupNode;

  // The word the popup currently shows — what the 发音 button speaks (the
  // clicked surface form, not the lemma, like the app).
  let spokenWord = "";
  // The popup's rows are filled through textContent only — book-derived
  // values (senses, transcriptions, the words themselves) can never become
  // markup here.
  function fillRow(id: string, value: string): void {
    const row = document.getElementById(id);
    if (!row) return;
    row.textContent = value;
    row.hidden = false;
  }
  function hideRow(id: string): void {
    const row = document.getElementById(id);
    if (!row) return;
    row.hidden = true;
  }
  // The clamp itself is the reading model's anchorPopup — the same math the
  // app's popup runs (plain arithmetic on the click point, no layout reads).
  function anchor(point: { x: number; y: number }): void {
    const { left, top } = anchorPopup(point, {
      width: window.innerWidth,
      height: window.innerHeight,
    });
    popup.style.left = left + "px";
    popup.style.top = top + "px";
  }
  function openPopup(word: string, point: { x: number; y: number }): void {
    spokenWord = word;
    const entry = lookupEntry(normalizeLookupToken(word));
    fillRow("lookup-head-word", word);
    if (entry) {
      hideRow("lookup-status");
      if (entry.lemma && entry.lemma !== entry.word) {
        fillRow("lookup-lemma", "词元 " + entry.lemma);
      } else {
        hideRow("lookup-lemma");
      }
      if (entry.ipa) fillRow("lookup-ipa", "/" + entry.ipa + "/");
      else hideRow("lookup-ipa");
      if (entry.pos) fillRow("lookup-pos", entry.pos);
      else hideRow("lookup-pos");
      if (entry.translation) fillRow("lookup-translation", entry.translation);
      else hideRow("lookup-translation");
    } else {
      // No entry knows the word (spec: 查不到的词提示无结果): say so, and
      // keep every sense row from the previous lookup hidden.
      hideRow("lookup-lemma");
      hideRow("lookup-ipa");
      hideRow("lookup-pos");
      hideRow("lookup-translation");
      fillRow("lookup-status", "词库中未收录这个词。");
    }
    anchor(point);
    popup.hidden = false;
  }
  // Dismissal mirrors the app's WordLookupPopup: a click that is neither
  // inside the popup nor on a word closes it (clicking another word moves
  // it instead), Escape closes it, and the ✕ button is the explicit close.
  function closePopup(): void {
    popup.hidden = true;
  }
  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (popup.contains(target)) return;
    const word = target.closest("[data-word]");
    if (!word) {
      closePopup();
      return;
    }
    const surface = word.getAttribute("data-word");
    if (surface === null) return;
    openPopup(surface, {
      x: event.clientX,
      y: event.clientY,
    });
  });
  document
    .getElementById("lookup-close")
    ?.addEventListener("click", closePopup);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closePopup();
  });

  // -- 发音 --
  // Browser speech synthesis for the popup's word: the reading model's
  // speakWord (the app's wordLookup re-exports the same function). Silent
  // no-op where the API is missing or partial — an unsupported environment
  // must never turn a click into an error. Whether any sound comes out
  // offline depends on the device's local voices.
  document.getElementById("lookup-speak")?.addEventListener("click", () => {
    speakWord(spokenWord);
  });
}

main();
