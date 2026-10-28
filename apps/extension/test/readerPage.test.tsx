import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ReaderPage } from "../src/reader/ReaderPage";
import { buildEpub } from "@lingualeaf/import-core/testing";
import { importBook } from "../src/reader/import-book";

// The page meets real files, so the tests drive real bytes: the shared
// deterministic builder (import-core/testing) assembles the EPUB, planted
// on the file input the way a user's picker would.
async function fixtureFile(name: string, bytes: Uint8Array): Promise<File> {
  return new File([bytes as BlobPart], name, {
    type: "application/epub+zip",
  });
}

const SAMPLE_EPUB = () =>
  buildEpub({
    title: "Skeleton Book",
    docs: [
      {
        href: "text/one.xhtml",
        body: "<h1>Chapter One</h1><p>Words arrive on the page. A second sentence follows.</p>",
      },
      {
        href: "text/two.xhtml",
        body: "<h2>Chapter Two</h2><p>More words live here.</p>",
      },
    ],
  });

async function pickFile(file: File): Promise<void> {
  const input = document.querySelector(
    'input[type="file"]'
  ) as HTMLInputElement;
  // configurable: a test re-plants files after an error phase.
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  fireEvent.change(input);
}

// The fixture baked asset: form hits, an inflection-index fallback, and
// words no table knows — the messy shapes real coverage has.
const FIXTURE_DICT = {
  ipa: { woke: "woʊk", run: "rʌn", today: "təˈdeɪ", quiet: "ˈkwaɪət" },
  inflections: { runs: "run" },
  entries: {},
};

function stubDictionaryFetch(data: object | null): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      data === null
        ? ({ ok: false, json: async () => ({}) } as unknown as Response)
        : ({ ok: true, json: async () => data } as unknown as Response)
    )
  );
}

// Exact-value reads through getAttribute — jsdom's selector engine matches
// attribute values case-insensitively, so the assertions never query on a
// literal value (CODING_STANDARDS).
const ipaValues = (): (string | null)[] =>
  [...document.querySelectorAll(".ipa-word-ipa")].map((el) =>
    el.getAttribute("data-ipa")
  );

describe("ReaderPage — the EPUB skeleton", () => {
  it("imports a fixture EPUB and reads it chapter by chapter", async () => {
    render(<ReaderPage />);
    await pickFile(await fixtureFile("book.epub", await SAMPLE_EPUB()));

    expect(
      await screen.findByRole("heading", { name: "Skeleton Book" })
    ).toBeInTheDocument();
    // First chapter's content, sentences split per 句子块 — the words ride
    // as clickable spans (the IPA line's segmentation, ticket 03).
    expect(await screen.findByText("Words")).toBeInTheDocument();
    expect(screen.getByText("arrive")).toBeInTheDocument();
    expect(screen.getByText("follows")).toBeInTheDocument();
    // The TOC knows both chapters; switching shows the other one.
    fireEvent.click(screen.getByRole("button", { name: "Chapter Two" }));
    expect(await screen.findByText("More")).toBeInTheDocument();
    expect(screen.queryByText("Words")).not.toBeInTheDocument();
  });

  it("reports a broken archive with the invalid-epub copy and keeps the entry usable", async () => {
    render(<ReaderPage />);
    const garbage = await fixtureFile(
      "broken.epub",
      new TextEncoder().encode("this is not a zip file")
    );
    await pickFile(garbage);

    expect(
      await screen.findByText("导入失败：文件无法解析，可能已损坏。")
    ).toBeInTheDocument();
    // The error is a phase, not a dead end: a good file still imports.
    await pickFile(await fixtureFile("book.epub", await SAMPLE_EPUB()));
    expect(
      await screen.findByRole("heading", { name: "Skeleton Book" })
    ).toBeInTheDocument();
  });

  it("declines non-EPUB files with the unsupported copy", async () => {
    render(<ReaderPage />);
    const pdf = await fixtureFile("paper.pdf", new Uint8Array([1, 2, 3]));
    await pickFile(pdf);

    expect(
      await screen.findByText("暂不支持这种文件——扩展阅读页当前支持 EPUB。")
    ).toBeInTheDocument();
  });
});

describe("ReaderPage — the IPA line (ticket 03)", () => {
  beforeEach(() => {
    stubDictionaryFetch(FIXTURE_DICT);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("pairs each word with its transcription; unknown words stay plain", async () => {
    const bytes = await buildEpub({
      title: "Paired Book",
      docs: [
        {
          href: "text/c.xhtml",
          body: "<h1>C</h1><p>Woke runs today.</p><p>The xqzzz stays quiet.</p>",
        },
      ],
    });
    render(<ReaderPage />);
    await pickFile(await fixtureFile("book.epub", bytes));

    // Slots land in word order: form hits and the lemma fallback (runs →
    // run) both answer; the walk pairs them under their own words.
    await screen.findByText("xqzzz");
    expect(ipaValues()).toEqual(["woʊk", "rʌn", "təˈdeɪ", "ˈkwaɪət"]);
    // A word the dictionary does not know renders as a plain lookup
    // target — no box, no shifted neighbors (缺词留空, 排版不乱).
    const unknown = screen.getByText("xqzzz");
    expect(unknown).toHaveClass("lookup-word");
  });

  it("hides the transcription with the toggle and brings it back", async () => {
    const bytes = await buildEpub({
      title: "Toggle Book",
      docs: [
        { href: "text/c.xhtml", body: "<h1>C</h1><p>Woke runs today.</p>" },
      ],
    });
    render(<ReaderPage />);
    await pickFile(await fixtureFile("book.epub", bytes));
    await screen.findByText("Woke");
    expect(ipaValues()).toEqual(["woʊk", "rʌn", "təˈdeɪ"]);

    const toggle = screen.getByRole("button", { name: "音标" });
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(toggle);
    // Clean reading: the transcriptions leave the DOM, the word units
    // stay (lookups keep working regardless of the toggle).
    expect(ipaValues()).toEqual([]);
    expect(screen.getByText("Woke")).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(ipaValues()).toEqual(["woʊk", "rʌn", "təˈdeɪ"]);
  });

  it("reads on without a dictionary — every slot just misses", async () => {
    stubDictionaryFetch(null); // asset missing (404)
    const bytes = await buildEpub({
      title: "Bare Book",
      docs: [
        { href: "text/c.xhtml", body: "<h1>C</h1><p>Woke runs today.</p>" },
      ],
    });
    render(<ReaderPage />);
    await pickFile(await fixtureFile("book.epub", bytes));

    await screen.findByText("Woke");
    expect(ipaValues()).toEqual([]);
    expect(screen.getByText("runs")).toHaveClass("lookup-word");
  });
});

describe("importBook — slot assembly (ticket 03)", () => {
  it("builds one slot per word: hit, lemma fallback, blank", async () => {
    const lookup = (token: string): string | null => {
      if (token === "Woke") return "woʊk";
      if (token === "runs") return "rʌn";
      return null;
    };
    const bytes = await SAMPLE_EPUB();
    const book = await importBook(
      bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength
      ) as ArrayBuffer,
      "book.epub",
      lookup
    );
    const first =
      book.chapters[0]?.blocks.filter((b) => b.kind === "sentence") ?? [];
    const [lead] = first;
    expect(lead).toEqual({
      kind: "sentence",
      text: "Words arrive on the page.",
      ipaSlots: ["", "", "", "", ""],
    });
  });
});
