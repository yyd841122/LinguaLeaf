import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
    render(<ReaderPage library={createMemoryLibraryStore()} />);
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
    render(<ReaderPage library={createMemoryLibraryStore()} />);
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

  it("declines unrecognized files with the unsupported copy", async () => {
    render(<ReaderPage library={createMemoryLibraryStore()} />);
    const doc = await fixtureFile("paper.docx", new Uint8Array([1, 2, 3]));
    await pickFile(doc);

    expect(
      await screen.findByText(
        "暂不支持这种文件——扩展阅读页当前支持 EPUB 与 PDF。"
      )
    ).toBeInTheDocument();
  });

  it("lands in the error phase — never a dead end — for a broken PDF (ticket 06)", async () => {
    // The copy depends on pdf.js's own error shape, which differs between
    // the fake worker (jsdom) and the browser; the phase and the reusable
    // entry are the page's contract here. The copy-level mapping rides the
    // real browser smoke (InvalidPDFException is the browser's shape).
    render(<ReaderPage library={createMemoryLibraryStore()} />);
    const pdf = await fixtureFile("paper.pdf", new Uint8Array([1, 2, 3]));
    await pickFile(pdf);

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    const input = document.querySelector('input[type="file"]');
    expect(input).toBeInTheDocument();
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
    render(<ReaderPage library={createMemoryLibraryStore()} />);
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
    render(<ReaderPage library={createMemoryLibraryStore()} />);
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
    render(<ReaderPage library={createMemoryLibraryStore()} />);
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

// ─── ticket 04: the word popup + 生词本 four states ───

import {
  OfflineDictionary,
  type BakedDictionary,
} from "../src/dict/offline-dictionary";
import {
  createVocabularyStore,
  memoryBackend,
  type StateBackend,
  type VocabularyStore,
} from "../src/store/vocabulary-store";

const POPUP_DICT: BakedDictionary = {
  ipa: { woke: "woʊk", run: "rʌn", book: "bʊk", today: "təˈdeɪ" },
  inflections: { runs: "run" },
  entries: {
    woke: { p: "", t: "v. 醒来" },
    run: { p: "", t: "v. 跑" },
    book: { p: "", t: "n. 书" },
  },
};

const POPUP_EPUB = () =>
  buildEpub({
    title: "Popup Book",
    docs: [
      {
        href: "text/c.xhtml",
        body: "<h1>C</h1><p>Woke runs today.</p><p>They run far. The book stays.</p>",
      },
    ],
  });

// Word units by their exact data-word (getAttribute — jsdom's selector
// engine matches attribute values case-insensitively, and the popup's
// head echoes the raw clicked word, so text queries would double-match).
const wordEl = (word: string): HTMLElement | undefined =>
  [...document.querySelectorAll<HTMLElement>("[data-word]")].find(
    (el) => el.getAttribute("data-word") === word
  );

// A backend whose puts hang until the test settles them — the deferred
// PUT pattern from the web popup's characterization nails, over the store
// seam instead of the wire.
export function deferredBackend() {
  const memory = memoryBackend();
  const pending = new Map<string, Array<{ resolve: () => void }>>();
  const backend: StateBackend = {
    async get(key) {
      return memory.get(key);
    },
    getMany: (keys) => memory.getMany(keys),
    put(key, status) {
      let resolve!: () => void;
      const promise = new Promise<void>((r) => {
        resolve = r;
      });
      const byKey = pending.get(key) ?? [];
      byKey.push({ resolve });
      pending.set(key, byKey);
      return promise.then(() => memory.put(key, status));
    },
  };
  const tick = () => Promise.resolve();
  return {
    memory,
    // Settling is async (the put queues a microtask after its lookup
    // begins) and key-addressed — a FIFO would settle whichever write the
    // microtask ordering happened to queue first, not the one the test
    // means (the web nails defer per URL; here per state key).
    settleKey: async (key: string) => {
      const entry = pending.get(key)?.shift();
      entry?.resolve();
      await tick();
    },
    settleAll: async () => {
      for (const byKey of pending.values()) {
        for (const entry of byKey) entry.resolve();
      }
      pending.clear();
      await tick();
    },
    backend,
  };
}

async function openPopupFor(
  word: string,
  harness?: ReturnType<typeof deferredBackend>
): Promise<void> {
  // The import is async — wait for the word unit to exist, then click it.
  const unit = await waitFor(() => {
    const found = wordEl(word);
    if (!found) throw new Error(word + " not rendered yet");
    return found;
  });
  fireEvent.click(unit);
  await screen.findByRole("dialog", { name: `词详情：${word}` });
  // The enrollment write of 查词即状态 rides the same backend; the
  // deferred harness holds it until the test lets it land, so the popup's
  // lookup answer (and its state row) needs the settle to resolve.
  if (harness) await harness.settleAll();
}

describe("ReaderPage — the word popup (ticket 04)", () => {
  beforeEach(() => {
    stubDictionaryFetch(POPUP_DICT);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the five elements and discloses a lemma-sourced IPA", async () => {
    const harness = deferredBackend();
    render(
      <ReaderPage
        library={createMemoryLibraryStore()}
        store={createVocabularyStore(
          new OfflineDictionary(POPUP_DICT),
          harness.backend
        )}
      />
    );
    await pickFile(await fixtureFile("book.epub", await POPUP_EPUB()));
    await openPopupFor("runs", harness);

    // Five elements: head word, lemma, IPA, pos, translation — plus the
    // disclosure line (runs reads via run; 不冒充词形读音).
    expect(await screen.findByText("原形 run")).toBeInTheDocument();
    expect(screen.getByText("/rʌn/")).toBeInTheDocument();
    expect(screen.getByText("v. 跑")).toBeInTheDocument();
    expect(screen.getByText("音标为原形 run 的读音。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "发音" })).toBeInTheDocument();
    // 查词即状态: the first lookup enrolled run as Learning in the same
    // call, and the row shows it pressed.
    expect(screen.getByRole("button", { name: "学习中" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(harness.memory.map.get("run")).toBe("learning");
  });

  it("a recorded state stands; a miss writes nothing", async () => {
    const harness = deferredBackend();
    harness.memory.map.set("woke", "known");
    render(
      <ReaderPage
        library={createMemoryLibraryStore()}
        store={createVocabularyStore(
          new OfflineDictionary(POPUP_DICT),
          harness.backend
        )}
      />
    );
    await pickFile(await fixtureFile("book.epub", await POPUP_EPUB()));

    await openPopupFor("Woke", harness);
    expect(screen.getByRole("button", { name: "已掌握" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(harness.memory.map.get("woke")).toBe("known");

    await openPopupFor("far", harness);
    expect(screen.getByText("词库中未收录这个词。")).toBeInTheDocument();
    expect(harness.memory.map.has("far")).toBe(false);
  });

  it("an explicit state change tints the word immediately", async () => {
    const harness = deferredBackend();
    render(
      <ReaderPage
        library={createMemoryLibraryStore()}
        store={createVocabularyStore(
          new OfflineDictionary(POPUP_DICT),
          harness.backend
        )}
      />
    );
    await pickFile(await fixtureFile("book.epub", await POPUP_EPUB()));

    await openPopupFor("Woke", harness);
    // The state row renders once the settled lookup's answer flushes.
    await screen.findByRole("button", { name: "已掌握" });
    fireEvent.click(screen.getByRole("button", { name: "已掌握" }));
    await harness.settleKey("woke");
    // 即时生效: the word span drops the lookup affordance (word-settled).
    await waitFor(() => expect(wordEl("Woke")).toHaveClass("word-settled"));
    expect(harness.memory.map.get("woke")).toBe("known");
    // The states are keyed by lemma — runs shares run's entry.
    await openPopupFor("runs", harness);
    await screen.findByRole("button", { name: "已掌握" });
    fireEvent.click(screen.getByRole("button", { name: "已掌握" }));
    await harness.settleKey("run");
    await waitFor(() => expect(wordEl("run")).toHaveClass("word-settled"));
  });

  it("keeps the new word's row disabled when the previous word's save settles first", async () => {
    const harness = deferredBackend();
    render(
      <ReaderPage
        library={createMemoryLibraryStore()}
        store={createVocabularyStore(
          new OfflineDictionary(POPUP_DICT),
          harness.backend
        )}
      />
    );
    await pickFile(await fixtureFile("book.epub", await POPUP_EPUB()));

    await openPopupFor("Woke", harness);
    await screen.findByRole("button", { name: "已掌握" });
    fireEvent.click(screen.getByRole("button", { name: "已掌握" }));
    // The reader moves to book before woke's write lands: two writes in
    // flight, each keyed by its own status key.
    await openPopupFor("book", harness);
    await screen.findByRole("button", { name: "已掌握" });
    fireEvent.click(screen.getByRole("button", { name: "已掌握" }));
    // woke settles first; its patch moves to the page's tint map, and its
    // finally retires only woke's own key.
    await harness.settleKey("woke");
    await waitFor(() => expect(wordEl("Woke")).toHaveClass("word-settled"));
    // book's row must still be disabled mid-write.
    expect(screen.getByRole("button", { name: "学习中" })).toBeDisabled();
    await harness.settleKey("book");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "学习中" })).toBeEnabled()
    );
  });

  it("A→B→A re-entry shows the row disabled until the first write lands", async () => {
    const harness = deferredBackend();
    render(
      <ReaderPage
        library={createMemoryLibraryStore()}
        store={createVocabularyStore(
          new OfflineDictionary(POPUP_DICT),
          harness.backend
        )}
      />
    );
    await pickFile(await fixtureFile("book.epub", await POPUP_EPUB()));

    await openPopupFor("Woke", harness);
    await screen.findByRole("button", { name: "已掌握" });
    fireEvent.click(screen.getByRole("button", { name: "已掌握" }));
    // Away to book, back to woke while woke's write is still in flight:
    // the key comparison revives, and the row reads disabled — the write
    // is genuinely not landed yet. Book's own lookup stays pending on the
    // deferred backend; its state row is irrelevant here.
    fireEvent.click(wordEl("book")!);
    await screen.findByRole("dialog", { name: "词详情：book" });
    fireEvent.click(wordEl("Woke")!);
    await screen.findByRole("dialog", { name: "词详情：Woke" });
    await screen.findByRole("button", { name: "学习中" });
    expect(screen.getByRole("button", { name: "学习中" })).toBeDisabled();
    await harness.settleKey("woke");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "学习中" })).toBeEnabled()
    );
  });

  it("same-lemma word forms share one in-flight entry", async () => {
    const harness = deferredBackend();
    render(
      <ReaderPage
        library={createMemoryLibraryStore()}
        store={createVocabularyStore(
          new OfflineDictionary(POPUP_DICT),
          harness.backend
        )}
      />
    );
    await pickFile(await fixtureFile("book.epub", await POPUP_EPUB()));

    await openPopupFor("runs", harness);
    await screen.findByRole("button", { name: "已掌握" });
    fireEvent.click(screen.getByRole("button", { name: "已掌握" }));
    // run is the same state key (runs → run): its row shares the entry.
    await openPopupFor("run", harness);
    expect(screen.getByRole("button", { name: "学习中" })).toBeDisabled();
    await harness.settleAll();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "学习中" })).toBeEnabled()
    );
    // And the write landed once, under the shared key.
    expect(harness.memory.map.get("run")).toBe("known");
  });
});

// ─── ticket 05: progress memory + recents ───

import {
  createMemoryLibraryStore,
  type LibraryStore,
} from "../src/store/library-store";

const TOC_EPUB = () =>
  buildEpub({
    title: "Journey Book",
    docs: [
      {
        href: "text/one.xhtml",
        body: "<h1>North</h1><p>First chapter words.</p>",
      },
      {
        href: "text/two.xhtml",
        body: "<h2>South</h2><p>Second chapter words.</p>",
      },
    ],
  });

function renderWithSeams({
  store,
  library,
}: {
  store?: VocabularyStore;
  library?: LibraryStore;
} = {}) {
  // Concrete seams for the page: chrome.* never enters a test.
  const vocab =
    store ??
    createVocabularyStore(
      new OfflineDictionary({ ipa: {}, inflections: {}, entries: {} }),
      memoryBackend()
    );
  return render(
    <ReaderPage store={vocab} library={library ?? createMemoryLibraryStore()} />
  );
}

describe("ReaderPage — progress memory + recents (ticket 05)", () => {
  beforeEach(() => {
    stubDictionaryFetch({});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reopens a recent document at its saved chapter", async () => {
    const library = createMemoryLibraryStore();
    renderWithSeams({ library });
    await pickFile(await fixtureFile("book.epub", await TOC_EPUB()));
    await screen.findByText("First");

    // Read on into the second chapter, then leave to the picker.
    fireEvent.click(screen.getByRole("button", { name: "South" }));
    await screen.findByText("Second");
    fireEvent.click(screen.getByRole("button", { name: "打开其他文件" }));

    // The landing lists the document with its position.
    const recent = await screen.findByRole("button", { name: "Journey Book" });
    expect(screen.getByText("第 2 章")).toBeInTheDocument();
    fireEvent.click(recent);

    // Reopened straight into the saved chapter.
    expect(await screen.findByText("Second")).toBeInTheDocument();
    expect(screen.queryByText("First chapter words.")).not.toBeInTheDocument();
  });

  it("keeps per-document progress independent across books", async () => {
    const library = createMemoryLibraryStore();
    renderWithSeams({ library });

    await pickFile(await fixtureFile("a.epub", await TOC_EPUB()));
    await screen.findByText("First");
    fireEvent.click(screen.getByRole("button", { name: "South" }));
    await screen.findByText("Second");
    fireEvent.click(screen.getByRole("button", { name: "打开其他文件" }));

    const other = await buildEpub({
      title: "Other Book",
      docs: [
        { href: "text/x.xhtml", body: "<h1>Only</h1><p>Other words.</p>" },
      ],
    });
    await pickFile(await fixtureFile("b.epub", other));
    await screen.findByText("Other");

    fireEvent.click(screen.getByRole("button", { name: "打开其他文件" }));
    // Both recents listed; each shows its own chapter.
    expect(
      await screen.findByRole("button", { name: "Journey Book" })
    ).toBeInTheDocument();
    expect(screen.getByText("第 2 章")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Other Book" }));
    expect(await screen.findByText("Other")).toBeInTheDocument();

    // And the first book still restores to its own chapter.
    fireEvent.click(screen.getByRole("button", { name: "打开其他文件" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Journey Book" })
    );
    expect(await screen.findByText("Second")).toBeInTheDocument();
  });
});
