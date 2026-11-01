// Unit seam of the browser-e2e harness: the pieces that are pure logic —
// the fixture book's markdown and the dist-freshness decision. The browser
// half is not unit-testable; the worked example (reading-bookmarks-04.mjs)
// is its test, run manually per acceptance (ticket: not gated).
import { describe, expect, it } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ENTRY_PREFIX_MAX_CHARS,
  buildBookMarkdown,
  distIsFresh,
  newestMtimeUnder,
} from "./harness.mjs";

describe("buildBookMarkdown", () => {
  const book = buildBookMarkdown({
    chapters: [{ title: "Chapter One" }, { title: "Chapter Two" }],
    sentencesPerChapter: 50,
  });

  it("opens one heading per chapter, in order", () => {
    const headings = book.split("\n").filter((line) => line.startsWith("# "));
    expect(headings).toEqual(["# Chapter One", "# Chapter Two"]);
    expect(book.indexOf("# Chapter One")).toBeLessThan(
      book.indexOf("# Chapter Two")
    );
  });

  it("carries exactly sentencesPerChapter sentences per chapter", () => {
    const chapters = book.split(/^# /m).slice(1);
    expect(chapters).toHaveLength(2);
    for (const chapter of chapters) {
      const paragraphs = chapter
        .split("\n\n")
        .filter((line) => line.startsWith("Sentence "));
      expect(paragraphs).toHaveLength(50);
    }
  });

  it("numbers sentences zero-padded to three digits", () => {
    expect(book).toContain("Sentence 001 of");
    expect(book).toContain("Sentence 032 of");
    expect(book).toContain("Sentence 050 of");
    // No unpadded escape into a fourth digit at 50 sentences/chapter.
    expect(book).not.toContain("Sentence 100 of");
  });

  // The discriminating property the whole fixture exists for: the panel
  // entry cuts the block text at ENTRY_PREFIX_MAX_CHARS (ReadingPage.tsx),
  // so a sentence number sitting past the cut leaves chapter-start and
  // deep-position entries indistinguishable — reading-bookmarks 04's
  // fixture lesson. Every sentence must carry its number inside the cut.
  it("puts every sentence number inside the prefix cut", () => {
    const sentences = book
      .split("\n")
      .filter((line) => line.startsWith("Sentence "));
    expect(sentences).toHaveLength(100);
    for (const [index, sentence] of sentences.entries()) {
      const number = String((index % 50) + 1).padStart(3, "0");
      const prefix = sentence.slice(0, ENTRY_PREFIX_MAX_CHARS);
      expect(
        prefix,
        `sentence ${number} outside its own ${ENTRY_PREFIX_MAX_CHARS}-char prefix`
      ).toContain(number);
    }
  });

  it("is deterministic across calls", () => {
    const again = buildBookMarkdown({
      chapters: [{ title: "Chapter One" }, { title: "Chapter Two" }],
      sentencesPerChapter: 50,
    });
    expect(again).toBe(book);
  });

  it("keeps one sentence per paragraph (no abbreviation traps)", () => {
    for (const line of book
      .split("\n")
      .filter((line) => line.startsWith("Sentence "))) {
      // One terminal period; no mid-line "." that sbd could split on.
      expect(line.endsWith(".")).toBe(true);
      expect(line.slice(0, -1)).not.toContain(". ");
    }
  });
});

describe("newestMtimeUnder", () => {
  it("returns the newest file mtime across nested dirs", () => {
    const root = mkdtempSync(join(tmpdir(), "bimtest-"));
    try {
      const deep = join(root, "a/b");
      mkdirSync(deep, { recursive: true });
      const old = join(root, "a/old.txt");
      const newDeep = join(deep, "new.txt");
      writeFileSync(old, "x");
      writeFileSync(newDeep, "x");
      const epoch = new Date(0);
      utimesSync(old, epoch, epoch);
      const later = new Date(Date.parse("2026-11-01T00:00:00Z"));
      utimesSync(newDeep, later, later);
      expect(newestMtimeUnder(root)).toBe(later.getTime());
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns null for a missing root", () => {
    expect(newestMtimeUnder(join(tmpdir(), "bimtest-missing-xyz"))).toBeNull();
  });
});

describe("distIsFresh", () => {
  const MS_HOUR = 60 * 60 * 1000;
  const now = Date.now();

  it("reads a missing dist as stale", () => {
    const root = mkdtempSync(join(tmpdir(), "fresh-"));
    try {
      const src = join(root, "src");
      mkdirSync(src, { recursive: true });
      writeFileSync(join(src, "a.ts"), "x");
      expect(
        distIsFresh({ sourcePaths: [src], distDir: join(root, "nope") })
      ).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reads dist newer than every source as fresh", () => {
    const root = mkdtempSync(join(tmpdir(), "fresh-"));
    try {
      const src = join(root, "src");
      const dist = join(root, ".output");
      mkdirSync(src, { recursive: true });
      mkdirSync(join(dist, "server"), { recursive: true });
      writeFileSync(join(src, "a.ts"), "x");
      writeFileSync(join(dist, "server", "main.js"), "x");
      utimesSync(
        join(src, "a.ts"),
        new Date(now - 2 * MS_HOUR),
        new Date(now - 2 * MS_HOUR)
      );
      utimesSync(
        join(dist, "server", "main.js"),
        new Date(now - MS_HOUR),
        new Date(now - MS_HOUR)
      );
      expect(distIsFresh({ sourcePaths: [src], distDir: dist })).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reads any source newer than dist as stale", () => {
    const root = mkdtempSync(join(tmpdir(), "fresh-"));
    try {
      const srcA = join(root, "src-a");
      const srcB = join(root, "src-b");
      const dist = join(root, ".output");
      mkdirSync(srcA, { recursive: true });
      mkdirSync(srcB, { recursive: true });
      mkdirSync(dist, { recursive: true });
      writeFileSync(join(srcA, "a.ts"), "x");
      writeFileSync(join(srcB, "b.ts"), "x");
      writeFileSync(join(dist, "main.js"), "x");
      utimesSync(
        join(srcA, "a.ts"),
        new Date(now - MS_HOUR),
        new Date(now - MS_HOUR)
      );
      utimesSync(
        join(dist, "main.js"),
        new Date(now - MS_HOUR),
        new Date(now - MS_HOUR)
      );
      // The one file that decides it: edited after the last build.
      utimesSync(join(srcB, "b.ts"), new Date(now), new Date(now));
      expect(distIsFresh({ sourcePaths: [srcA, srcB], distDir: dist })).toBe(
        false
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
