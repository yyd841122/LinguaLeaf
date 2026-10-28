import { describe, expect, it } from "vitest";
import { dirname, join } from "../src/posix-path.js";

// The two node:path.posix operations the EPUB front half uses, pinned
// against node's actual semantics — including the trailing-slash case a
// review round caught: node keeps "a/b/" through normalization, and an
// EPUB spine href ending in "/" must keep missing the archive lookup
// exactly as it did under node:path.
describe("posix-path (node:path.posix semantics)", () => {
  it("dirname matches node on the shapes EPUB paths take", () => {
    expect(dirname("OEBPS/content.opf")).toBe("OEBPS");
    expect(dirname("OEBPS")).toBe(".");
    expect(dirname("content.opf")).toBe(".");
    expect(dirname("/a")).toBe("/");
    expect(dirname("a/b/")).toBe("a");
    expect(dirname("/a/b/c.xhtml")).toBe("/a/b");
    expect(dirname("")).toBe(".");
  });

  it("join matches node, preserving trailing slashes", () => {
    expect(join("OEBPS", "text/ch1.xhtml")).toBe("OEBPS/text/ch1.xhtml");
    expect(join(".", "text/ch1.xhtml")).toBe("text/ch1.xhtml");
    expect(join("OEBPS/text", "../images/x.png")).toBe("OEBPS/images/x.png");
    expect(join("OEBPS", "one.xhtml/")).toBe("OEBPS/one.xhtml/");
    expect(join("a/", "b/")).toBe("a/b/");
    expect(join("a/", "..")).toBe(".");
    expect(join("a/", "..", "b")).toBe("b");
    expect(join("/a", "../../b")).toBe("/b");
  });

  it("the EPUB href walk keeps node's behavior end to end", () => {
    // The chain epub.ts runs: dirname of the package path, join with the
    // decoded href.
    const packagePath = "OEBPS/content.opf";
    const dir = dirname(packagePath);
    expect(join(dir, "text/one.xhtml/")).toBe("OEBPS/text/one.xhtml/");
  });
});
