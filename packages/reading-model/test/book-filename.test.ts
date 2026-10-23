import { describe, expect, it } from "vitest";
import {
  annotatedBookFilename,
  cleanFilenameBase,
} from "../src/book-filename.js";

describe("cleanFilenameBase (the one cleaning pass)", () => {
  it("keeps the Chinese title as-is", () => {
    expect(cleanFilenameBase("三体.html")).toBe("三体.html");
  });

  it("replaces what no filesystem accepts with underscores", () => {
    expect(cleanFilenameBase('a/b:c*d?e"f<g>h|i')).toBe("a_b_c_d_e_f_g_h_i");
  });

  it("strips the trailing dots and spaces that Windows drops", () => {
    expect(cleanFilenameBase("The End. ")).toBe("The End");
  });

  it("returns an empty base for empty or missing names — callers fall back", () => {
    expect(cleanFilenameBase("")).toBe("");
    expect(cleanFilenameBase("   ")).toBe("");
    expect(cleanFilenameBase(null)).toBe("");
  });
});

describe("annotatedBookFilename (the server's attachment name)", () => {
  it("names the attachment from a title, suffix always appended", () => {
    expect(annotatedBookFilename("三体")).toBe("三体.html");
  });

  it("falls back to book.html when nothing survives the cleaning", () => {
    // Illegal characters become underscores (they never clean to nothing);
    // only dot/space-only titles actually fall back.
    expect(annotatedBookFilename("///")).toBe("___.html");
    expect(annotatedBookFilename("...")).toBe("book.html");
    expect(annotatedBookFilename("")).toBe("book.html");
    expect(annotatedBookFilename(null)).toBe("book.html");
  });
});
