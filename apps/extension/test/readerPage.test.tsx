import { WordLookupPopup as KernelPopup } from "@lingualeaf/reading-model/react";
import {
  settleRaceSuite,
  wordLookupRaceSuite,
} from "@lingualeaf/reading-model/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { createMemoryPdfNotesStore } from "../src/store/pdf-notes-store";
import { createMemoryPdfPositionStore } from "../src/store/pdf-position-store";
import { createMemoryNotesStore } from "../src/store/notes-store";
import {
  createMemoryPdfBytesBackend,
  createPdfBytesStore,
} from "../src/store/idb-bytes-store";
import { ReaderPage } from "../src/reader/ReaderPage";
import { buildEpub } from "@lingualeaf/import-core/testing";
import { importBook } from "../src/reader/import-book";
import * as pdf from "../src/reader/pdf";

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
    render(
      <ReaderPage
        pdfBytes={createPdfBytesStore(createMemoryPdfBytesBackend())}
        notes={createMemoryNotesStore()}
        library={createMemoryLibraryStore()}
      />
    );
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
    render(
      <ReaderPage
        pdfBytes={createPdfBytesStore(createMemoryPdfBytesBackend())}
        notes={createMemoryNotesStore()}
        library={createMemoryLibraryStore()}
      />
    );
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
    render(
      <ReaderPage
        pdfBytes={createPdfBytesStore(createMemoryPdfBytesBackend())}
        notes={createMemoryNotesStore()}
        library={createMemoryLibraryStore()}
      />
    );
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
    render(
      <ReaderPage
        pdfBytes={createPdfBytesStore(createMemoryPdfBytesBackend())}
        notes={createMemoryNotesStore()}
        library={createMemoryLibraryStore()}
      />
    );
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
    render(
      <ReaderPage
        pdfBytes={createPdfBytesStore(createMemoryPdfBytesBackend())}
        notes={createMemoryNotesStore()}
        library={createMemoryLibraryStore()}
      />
    );
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
    render(
      <ReaderPage
        pdfBytes={createPdfBytesStore(createMemoryPdfBytesBackend())}
        notes={createMemoryNotesStore()}
        library={createMemoryLibraryStore()}
      />
    );
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
    render(
      <ReaderPage
        pdfBytes={createPdfBytesStore(createMemoryPdfBytesBackend())}
        notes={createMemoryNotesStore()}
        library={createMemoryLibraryStore()}
      />
    );
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
  type VocabState,
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
    // Enrollment defers only when it would WRITE: a lookup whose state
    // already exists answers immediately (the real backend's read is
    // instant), so a re-visited word's found phase does not hang on the
    // deferred gate while an unrelated put of its key is in flight.
    enroll(key) {
      const existing = memory.map.get(key) ?? null;
      if (existing) return Promise.resolve(existing);
      let resolve!: (state: VocabState) => void;
      const promise = new Promise<VocabState>((r) => {
        resolve = r;
      });
      const byKey = pending.get(key) ?? [];
      byKey.push({
        resolve: () => {
          const existing = memory.map.get(key) ?? null;
          if (existing) {
            resolve(existing);
            return;
          }
          void memory.put(key, "learning");
          resolve("learning");
        },
      });
      pending.set(key, byKey);
      return promise;
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
        pdfBytes={createPdfBytesStore(createMemoryPdfBytesBackend())}
        notes={createMemoryNotesStore()}
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
    expect(await screen.findByText("词元 run")).toBeInTheDocument();
    expect(screen.getByText("/rʌn/")).toBeInTheDocument();
    expect(screen.getByText("v. 跑")).toBeInTheDocument();
    expect(screen.getByText("音标为词元 run 的读音。")).toBeInTheDocument();
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
        pdfBytes={createPdfBytesStore(createMemoryPdfBytesBackend())}
        notes={createMemoryNotesStore()}
        library={createMemoryLibraryStore()}
        store={createVocabularyStore(
          new OfflineDictionary(POPUP_DICT),
          harness.backend
        )}
      />
    );
    await pickFile(await fixtureFile("book.epub", await POPUP_EPUB()));

    await openPopupFor("Woke", harness);
    expect(
      await screen.findByRole("button", { name: "已掌握", pressed: true })
    ).toBeInTheDocument();
    expect(harness.memory.map.get("woke")).toBe("known");

    await openPopupFor("far", harness);
    expect(screen.getByText("词库中未收录这个词。")).toBeInTheDocument();
    expect(harness.memory.map.has("far")).toBe(false);
  });

  it("an explicit state change tints the word immediately", async () => {
    const harness = deferredBackend();
    render(
      <ReaderPage
        pdfBytes={createPdfBytesStore(createMemoryPdfBytesBackend())}
        notes={createMemoryNotesStore()}
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
        pdfBytes={createPdfBytesStore(createMemoryPdfBytesBackend())}
        notes={createMemoryNotesStore()}
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
        pdfBytes={createPdfBytesStore(createMemoryPdfBytesBackend())}
        notes={createMemoryNotesStore()}
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
        pdfBytes={createPdfBytesStore(createMemoryPdfBytesBackend())}
        notes={createMemoryNotesStore()}
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
    // Direct click, no settle — the known-put from runs must still be in
    // flight here, and run's own lookup answers instantly (its state
    // already exists, nothing to defer).
    fireEvent.click(wordEl("run")!);
    await screen.findByRole("dialog", { name: "词详情：run" });
    await screen.findByRole("button", { name: "学习中" });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "学习中" })).toBeDisabled()
    );
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
    <ReaderPage
      pdfBytes={createPdfBytesStore(createMemoryPdfBytesBackend())}
      notes={createMemoryNotesStore()}
      store={vocab}
      pdfNotes={createMemoryPdfNotesStore()}
      pdfPositions={createMemoryPdfPositionStore()}
      library={library ?? createMemoryLibraryStore()}
    />
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

  it("a slow reopen cannot replace a document the reader already chose", async () => {
    const base = createMemoryLibraryStore();
    // Holder object: assignment happens inside openDocument's closure,
    // which control-flow narrowing cannot see.
    const slowOpen: { release: (() => void) | null } = { release: null };
    const library: LibraryStore = {
      ...base,
      openDocument(id) {
        if (id !== "doc:Journey Book") return base.openDocument(id);
        const stored = base.openDocument(id);
        return new Promise((resolve) => {
          slowOpen.release = () => void stored.then(resolve);
        });
      },
    };
    renderWithSeams({ library });

    // Both documents on the recents list.
    await pickFile(await fixtureFile("a.epub", await TOC_EPUB()));
    await screen.findByText("First");
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

    // Journey's open hangs; the reader picks Other while it is in flight.
    fireEvent.click(
      await screen.findByRole("button", { name: "Journey Book" })
    );
    fireEvent.click(screen.getByRole("button", { name: "Other Book" }));
    expect(await screen.findByText("Other")).toBeInTheDocument();

    // The slow answer lands late: the choice stands.
    slowOpen.release?.();
    await waitFor(() =>
      expect(screen.queryByText("North")).not.toBeInTheDocument()
    );
    expect(screen.getByText("Other")).toBeInTheDocument();
  });

  it("a failed reopen stays silent on the picker and stays retryable", async () => {
    const base = createMemoryLibraryStore();
    const flaky: { reject: boolean } = { reject: true };
    // The rejection is gated: it only fires inside the act below, so the
    // assertions read the settled after-failure state, never a
    // pre-rejection snapshot (CODING_STANDARDS, no-change claims flush
    // inside act).
    let release!: () => void;
    const gated = new Promise<void>((r) => {
      release = r;
    });
    const library: LibraryStore = {
      ...base,
      openDocument(id) {
        if (flaky.reject) {
          flaky.reject = false;
          return gated.then(() => Promise.reject(new Error("storage hiccup")));
        }
        return base.openDocument(id);
      },
    };
    renderWithSeams({ library });
    await pickFile(await fixtureFile("a.epub", await TOC_EPUB()));
    await screen.findByText("First");
    fireEvent.click(screen.getByRole("button", { name: "打开其他文件" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Journey Book" })
    );

    // Let the rejection and its landing complete before reading anything.
    await act(async () => {
      release();
      await gated;
      await Promise.resolve();
      await Promise.resolve();
    });
    // Silent by contract: no error phase, no alert, no status notice.
    // The error phase would keep the picker and recents rendered, so the
    // discriminating assertions are the absent failure surfaces, not the
    // picker's presence.
    expect(document.querySelector(".reader-error")).toBeNull();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(document.querySelector('input[type="file"]')).not.toBeNull();
    expect(
      screen.getByRole("button", { name: "Journey Book" })
    ).toBeInTheDocument();

    // Another try lands: the same recents entry reopens the document.
    fireEvent.click(screen.getByRole("button", { name: "Journey Book" }));
    expect(await screen.findByText("First")).toBeInTheDocument();
  });
});

wordLookupRaceSuite({
  createHarness() {
    const harness = deferredBackend();
    // Existing states make lookup immediate while explicit saves still use
    // the same deferred memory backend as the page's original race tests.
    for (const key of ["woke", "book", "run"])
      harness.memory.map.set(key, "learning");
    const gateway = createVocabularyStore(
      new OfflineDictionary(POPUP_DICT),
      harness.backend
    );
    return {
      gateway,
      settle: (word: string) => harness.settleKey(gateway.stateKey(word)),
      dispose() {},
    };
  },
  renderPopup(gateway, word, onStatusApplied) {
    const popup = (word: string) => (
      <KernelPopup
        click={{ word, point: { x: 100, y: 100 } }}
        gateway={gateway}
        onClose={() => {}}
        onStatusApplied={onStatusApplied}
      />
    );
    const view = render(popup(word));
    return {
      async open(word: string) {
        view.rerender(popup(word));
        await screen.findByRole("button", { name: "学习中" });
      },
    };
  },
  button: (status) =>
    screen.getByRole<HTMLButtonElement>("button", {
      name: { learning: "学习中", known: "已掌握", ignored: "已忽略" }[status],
    }),
  click: (button) => fireEvent.click(button),
  waitFor,
});

// ─── settle-channel 02: the tint bulk read's races ───

// A backend whose chapter bulk reads (statesFor → getMany) hang until the
// test releases them, delivering what the read captured at call time — the
// real backend's read is a call-time read, so a late release carries the
// pre-patch store, not whatever has landed since. The put/enroll deferral
// rides the shared deferredBackend unchanged.
function bulkDeferredBackend() {
  const base = deferredBackend();
  const holds: Array<() => void> = [];
  const backend: StateBackend = {
    ...base.backend,
    getMany(keys) {
      const read = base.memory.getMany(keys);
      return new Promise<Map<string, VocabState>>((resolve) => {
        holds.push(() => void read.then(resolve));
      });
    },
  };
  return {
    ...base,
    backend,
    releaseHold: async (index: number) => {
      const release = holds[index];
      if (!release) throw new Error(`no held bulk read at ${index}`);
      await act(async () => {
        release();
      });
    },
  };
}

describe("ReaderPage — the tint bulk read's races (settle-channel 02)", () => {
  beforeEach(() => {
    stubDictionaryFetch(POPUP_DICT);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("a late bulk read keeps the reader's patch (merge-wins)", async () => {
    const harness = bulkDeferredBackend();
    // Pre-patch store: the held read will carry learning for woke.
    harness.memory.map.set("woke", "learning");
    renderWithSeams({
      store: createVocabularyStore(
        new OfflineDictionary(POPUP_DICT),
        harness.backend
      ),
    });
    await pickFile(await fixtureFile("book.epub", await POPUP_EPUB()));
    // The chapter renders (the bulk read hangs on the held getMany) and
    // the reader opens woke's popup.
    await openPopupFor("Woke");
    fireEvent.click(screen.getByRole("button", { name: "已掌握" }));
    await harness.settleKey("woke");
    await waitFor(() => expect(wordEl("Woke")).toHaveClass("word-settled"));

    // The held read lands late carrying woke's pre-patch state: the
    // patched key keeps the reader's value, so the tint stands.
    await harness.releaseHold(0);
    expect(wordEl("Woke")).toHaveClass("word-settled");
    expect(harness.memory.map.get("woke")).toBe("known");
  });

  it("a chapter's late bulk read tints nothing after the switch", async () => {
    const harness = bulkDeferredBackend();
    // A state both chapters' word sets reach, so the stale read's answer
    // would tint the new chapter if it were not discarded.
    harness.memory.map.set("words", "known");
    renderWithSeams({
      store: createVocabularyStore(
        new OfflineDictionary(POPUP_DICT),
        harness.backend
      ),
    });
    await pickFile(await fixtureFile("book.epub", await TOC_EPUB()));
    await screen.findByText("First");

    // Chapter 1's bulk read hangs; the reader moves on to chapter 2,
    // whose own read hangs behind it.
    fireEvent.click(screen.getByRole("button", { name: "South" }));
    await screen.findByText("Second");

    // The stale read lands: chapter 1's answer must not tint chapter 2.
    await harness.releaseHold(0);
    expect(document.querySelector(".word-settled")).toBeNull();

    // Positive control: the current chapter's read does tint.
    await harness.releaseHold(1);
    await waitFor(() =>
      expect(document.querySelector(".word-settled")).not.toBeNull()
    );
  });
});

// The popup station over the store seam (settle-channel 02): the same
// claims as the web mount, a rejectable deferred backend instead of the
// wire. serialArms for the reason recorded there — one fresh arm at a
// time; the arm-side clear is the popup's recovery by design.
settleRaceSuite({
  serialArms: true,
  landed: true,
  async createHarness() {
    const memory = memoryBackend();
    const pending = new Map<
      string,
      Array<{ resolve: () => void; reject: () => void }>
    >();
    const backend: StateBackend = {
      async get(key) {
        return memory.get(key);
      },
      getMany: (keys) => memory.getMany(keys),
      put(key, status) {
        let resolve!: () => void;
        let reject!: () => void;
        const promise = new Promise<void>((res, rej) => {
          resolve = res;
          reject = rej;
        });
        const byKey = pending.get(key) ?? [];
        byKey.push({ resolve, reject });
        pending.set(key, byKey);
        return promise.then(() => memory.put(key, status));
      },
      enroll(key) {
        const existing = memory.map.get(key) ?? null;
        if (existing) return Promise.resolve(existing);
        void memory.put(key, "learning");
        return Promise.resolve("learning");
      },
    };
    for (const key of ["woke", "book"]) memory.map.set(key, "learning");
    const gateway = createVocabularyStore(
      new OfflineDictionary(POPUP_DICT),
      backend
    );
    const landedFacts: {
      word: string;
      lemma: string | null;
      status: VocabState;
    }[] = [];
    const popup = (word: string) => (
      <KernelPopup
        click={{ word, point: { x: 100, y: 100 } }}
        gateway={gateway}
        onClose={() => {}}
        onStatusApplied={(fact) => landedFacts.push(fact)}
      />
    );
    const view = render(popup("woke"));
    await screen.findByRole("button", { name: "学习中" });
    // Pressed-delta baseline, as the web mount records it: the lookups'
    // own statuses render pressed without any application in-scenario.
    const buttonName = (status: VocabState) =>
      ({ learning: "学习中", known: "已掌握", ignored: "已忽略" })[status];
    const pressedNow = () =>
      (["learning", "known", "ignored"] as const).filter(
        (status) =>
          screen
            .getByRole("button", { name: buttonName(status) })
            .getAttribute("aria-pressed") === "true"
      );
    const baseline = new Set(pressedNow());
    let current = "woke";
    const settle = async (key: string, fail: boolean) => {
      const entry = pending.get(key)?.shift();
      if (!entry) throw new Error(`no pending save for ${key}`);
      await act(async () => {
        if (fail) entry.reject();
        else entry.resolve();
        await Promise.resolve();
      });
    };
    return {
      async arm() {
        const key = gateway.stateKey(current);
        fireEvent.click(screen.getByRole("button", { name: "已掌握" }));
        await Promise.resolve();
        if (!pending.has(key))
          throw new Error(`the arm's save never left: ${key}`);
        return {
          resolve: () => settle(key, false),
          reject: () => settle(key, true),
        };
      },
      failed: () => screen.queryByText("状态保存失败，请重试。") !== null,
      applied: () => pressedNow().filter((status) => !baseline.has(status)),
      landed: () => landedFacts,
      async invalidate() {
        current = "book";
        view.rerender(popup("book"));
        await screen.findByRole("button", { name: "学习中" });
      },
      dispose() {},
    };
  },
});

describe("ReaderPage — PDF word keyboard lookup", () => {
  beforeEach(() => {
    stubDictionaryFetch(POPUP_DICT);
    // Only PDF decoding and canvas rendering are replaced: the page's
    // delegation, vocabulary store, and popup all run as they do for EPUB.
    vi.spyOn(pdf, "openPdf").mockResolvedValue({
      title: "Keyboard PDF",
      pageCount: 1,
      doc: {
        destroy: vi.fn().mockResolvedValue(undefined),
      } as unknown as pdf.PdfSession["doc"],
    });
    vi.spyOn(pdf, "sampleTextLengths").mockResolvedValue([120]);
    vi.spyOn(pdf, "renderPdfPage").mockImplementation(async (_, overlay) => {
      const word = document.createElement("span");
      word.className = "pdf-word";
      word.dataset.pdfWord = "Woke";
      word.dataset.word = "Woke";
      word.setAttribute("role", "button");
      word.tabIndex = 0;
      word.textContent = "Woke";
      const ipa = document.createElement("span");
      ipa.className = "pdf-ipa";
      ipa.dataset.ipa = "woʊk";
      ipa.textContent = "woʊk";
      word.appendChild(ipa);
      overlay.appendChild(word);
      return { wordCount: 1, ipaCount: 1 };
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function openPdfWord() {
    renderWithSeams({
      store: createVocabularyStore(
        new OfflineDictionary(POPUP_DICT),
        memoryBackend()
      ),
    });
    await pickFile(
      new File(["PDF decoder fixture"], "keyboard.pdf", {
        type: "application/pdf",
      })
    );
    return waitFor(() => {
      const word = wordEl("Woke");
      expect(word).toHaveClass("pdf-word");
      return word!;
    });
  }

  it.each(["Enter", " "])(
    "opens the focused PDF word with %j and anchors at its bottom center",
    async (key) => {
      const word = await openPdfWord();
      vi.spyOn(word, "getBoundingClientRect").mockReturnValue(
        new DOMRect(100, 200, 80, 20)
      );
      word.focus();
      expect(word).toHaveFocus();
      const event = new KeyboardEvent("keydown", {
        key,
        bubbles: true,
        cancelable: true,
      });
      fireEvent(word, event);
      expect(event.defaultPrevented).toBe(true);
      const dialog = await screen.findByRole("dialog", {
        name: "词详情：Woke",
      });
      // Bottom-center point (140, 220), then the popup's (-20, +14) offset.
      expect(dialog.style.left).toBe("120px");
      expect(dialog.style.top).toBe("234px");
    }
  );

  it.each(["Enter", " "])(
    "resolves a nested PDF IPA target with %j and uses that target's box",
    async (key) => {
      const word = await openPdfWord();
      const ipa = word.querySelector<HTMLElement>(".pdf-ipa")!;
      vi.spyOn(word, "getBoundingClientRect").mockReturnValue(
        new DOMRect(100, 200, 80, 20)
      );
      vi.spyOn(ipa, "getBoundingClientRect").mockReturnValue(
        new DOMRect(300, 400, 40, 10)
      );
      const event = new KeyboardEvent("keydown", {
        key,
        bubbles: true,
        cancelable: true,
      });
      fireEvent(ipa, event);
      expect(event.defaultPrevented).toBe(true);
      const dialog = await screen.findByRole("dialog", {
        name: "词详情：Woke",
      });
      expect(dialog.style.left).toBe("300px");
      expect(dialog.style.top).toBe("424px");
    }
  );

  it.each(["word", "ipa"])(
    "keeps pointer coordinates for clicks on the PDF %s",
    async (target) => {
      const word = await openPdfWord();
      vi.spyOn(word, "getBoundingClientRect").mockReturnValue(
        new DOMRect(100, 200, 80, 20)
      );
      fireEvent.click(
        target === "word" ? word : word.querySelector(".pdf-ipa")!,
        { clientX: 73, clientY: 81 }
      );
      const dialog = await screen.findByRole("dialog", {
        name: "词详情：Woke",
      });
      expect(dialog.style.left).toBe("53px");
      expect(dialog.style.top).toBe("95px");
    }
  );

  it("leaves other keys and non-word keyboard targets alone", async () => {
    const word = await openPdfWord();
    for (const [target, key] of [
      [word, "ArrowDown"],
      [document.querySelector(".pdf-stage canvas")!, " "],
    ] as const) {
      const event = new KeyboardEvent("keydown", {
        key,
        bubbles: true,
        cancelable: true,
      });
      fireEvent(target, event);
      expect(event.defaultPrevented).toBe(false);
    }
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

// ─── annotated-blocks stage 1: host characterization (no kernel imports) ───
describe("ReaderPage — annotated blocks characterization", () => {
  beforeEach(() => stubDictionaryFetch(POPUP_DICT));
  afterEach(() => vi.unstubAllGlobals());

  async function openPinnedChapter() {
    const library = createMemoryLibraryStore();
    await library.saveDocument({
      id: "annotated-pins",
      title: "Annotated pins",
      book: {
        title: "Annotated pins",
        chapters: [
          {
            title: "Pinned chapter",
            level: null,
            blocks: [
              { kind: "sentence", text: "Woke, Woke!", ipaSlots: ["woʊk", ""] },
              { kind: "code", text: "const Woke = 1;" },
              { kind: "raw", text: "Raw Woke" },
              { kind: "image", text: "Woke portrait" },
              {
                kind: "sentence",
                text: "book Woke.",
                ipaSlots: ["bad-length"],
              },
              { kind: "image", text: "" },
            ],
          },
        ],
      },
    });
    const memory = memoryBackend();
    memory.map.set("woke", "known");
    memory.map.set("book", "ignored");
    renderWithSeams({
      library,
      store: createVocabularyStore(new OfflineDictionary(POPUP_DICT), memory),
    });
    fireEvent.click(
      await screen.findByRole("button", { name: "Annotated pins" })
    );
    const section = await screen.findByRole("region", {
      name: "Pinned chapter",
    });
    await waitFor(() => expect(wordEl("Woke")).toHaveClass("word-settled"));
    return section;
  }

  it("keeps lookup statuses and wrappers across plain blocks without adding annotation rows", async () => {
    const section = await openPinnedChapter();
    const wrappers = [...section.querySelectorAll("[data-block-index]")];
    expect(wrappers.map((el) => el.getAttribute("data-block-index"))).toEqual([
      "0",
      "1",
      "2",
      "3",
      "4",
      "5",
    ]);
    const roots = wrappers.map((el) => el.firstElementChild!);
    expect(roots.map((el) => el.tagName)).toEqual([
      "DIV",
      "PRE",
      "P",
      "FIGURE",
      "DIV",
      "FIGURE",
    ]);
    expect(roots.every((el) => !el.hasAttribute("data-position"))).toBe(true);
    expect(roots[1]?.querySelector("code")).toHaveTextContent(
      "const Woke = 1;"
    );
    expect(roots[2]).toHaveTextContent("Raw Woke");
    expect(roots[3]?.querySelector("figcaption")).toHaveTextContent(
      "Woke portrait"
    );
    expect(roots[5]?.querySelector("figcaption")).toBeNull();
    const words = [...section.querySelectorAll<HTMLElement>("[data-word]")];
    expect(words.map((el) => el.className)).toEqual([
      "ipa-word word-settled",
      "lookup-word word-settled",
      "lookup-word word-settled",
      "lookup-word word-settled",
    ]);
    for (const word of words) {
      expect(word).toHaveAttribute("role", "button");
      expect(word).toHaveAttribute("tabindex", "0");
    }
    expect(roots[0]?.querySelector(".original-line")?.textContent).toBe(
      "Woke, Woke!✎"
    );
    expect(section.querySelector(".ipa-word-ipa")).toBeEmptyDOMElement();
    expect(section.querySelector(".ipa-word-ipa")).toHaveAttribute(
      "data-ipa",
      "woʊk"
    );
    expect(section.querySelector(".ipa-line, .translation-line")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "音标" }));
    expect(
      section.querySelector(".ipa-word-ipa, .ipa-line, .translation-line")
    ).toBeNull();
    expect(section.querySelectorAll("[data-word]")).toHaveLength(4);
    expect(section.querySelectorAll(".word-settled")).toHaveLength(4);
  });

  it("delegates nested keyboard targets, prevents only lookup keys, and anchors at their box", async () => {
    const section = await openPinnedChapter();
    const target = section.querySelector<HTMLElement>(".ipa-word-text")!;
    const box = vi.spyOn(target, "getBoundingClientRect").mockReturnValue({
      left: 32,
      width: 40,
      bottom: 91,
    } as DOMRect);
    for (const key of ["Enter", " "]) {
      const event = new KeyboardEvent("keydown", {
        key,
        bubbles: true,
        cancelable: true,
      });
      fireEvent(target, event);
      expect(event.defaultPrevented).toBe(true);
      const dialog = await screen.findByRole("dialog", {
        name: "词详情：Woke",
      });
      expect(dialog.style.left).toBe("32px");
      expect(dialog.style.top).toBe("105px");
      fireEvent.keyDown(document, { key: "Escape" });
    }
    expect(box).toHaveBeenCalledTimes(2);
    const other = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    fireEvent(target, other);
    const nonWord = new KeyboardEvent("keydown", {
      key: " ",
      bubbles: true,
      cancelable: true,
    });
    fireEvent(section.querySelector(".raw-block")!, nonWord);
    fireEvent.click(section.querySelector(".raw-block")!);
    expect(other.defaultPrevented).toBe(false);
    expect(nonWord.defaultPrevented).toBe(false);
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(target, { clientX: 73, clientY: 81 });
    const dialog = await screen.findByRole("dialog", { name: "词详情：Woke" });
    expect(dialog.style.left).toBe("53px");
    expect(dialog.style.top).toBe("95px");
  });
});

// ─── annotated-blocks stage 2: shared suite, lookup status adapter ───
import {
  AnnotatedBlockView as SharedAnnotatedBlockView,
  createWordHandlers as sharedWordHandlers,
} from "@lingualeaf/reading-model/react";
import {
  annotatedBlocksSuite,
  type AnnotatedBlocksScenario,
} from "@lingualeaf/reading-model/testing";
import { segmentOriginal } from "@lingualeaf/reading-model";

annotatedBlocksSuite({
  statusSource: "lookup",
  render(scenario) {
    const tree = (scenario: AnnotatedBlocksScenario) => {
      const states = new Map<string, VocabState | null>();
      for (const block of scenario.blocks) {
        if (block.kind !== "sentence") continue;
        let index = 0;
        for (const segment of segmentOriginal(block.text, block.ipaSlots)
          .segments) {
          if (segment.kind !== "word") continue;
          states.set(segment.word, block.statuses[index] ?? null);
          index += 1;
        }
      }
      const stateOf = (word: string) => states.get(word) ?? null;
      return (
        <section
          {...(scenario.onWordClick
            ? sharedWordHandlers(scenario.onWordClick)
            : {})}
        >
          {scenario.blocks.map((block, index) => (
            <SharedAnnotatedBlockView
              key={index}
              block={block}
              showIpa={scenario.showIpa ?? true}
              showTranslation={scenario.showTranslation ?? true}
              statusOf={(word, wordIndex) => {
                scenario.onStatusRead?.(word, wordIndex);
                return stateOf(word);
              }}
            />
          ))}
        </section>
      );
    };
    const view = render(tree(scenario));
    return {
      container: view.container,
      rerender: (next) => view.rerender(tree(next)),
    };
  },
  click: (target, point) =>
    fireEvent.click(target, { clientX: point.x, clientY: point.y }),
  keyDown(target, key) {
    const event = new KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
    });
    fireEvent(target, event);
    return event;
  },
});
// ─── annotated-blocks stage 3: CSS wiring pins ───
import { readFileSync as readAnnotatedCss } from "node:fs";
import {
  dirname as annotatedDirname,
  resolve as resolveAnnotatedCss,
} from "node:path";
import { fileURLToPath as annotatedFilePath } from "node:url";

describe("ReaderPage — shared settled-hover CSS wiring", () => {
  beforeEach(() => stubDictionaryFetch(POPUP_DICT));
  afterEach(() => vi.unstubAllGlobals());

  it("gives PDF keyboard focus the translucent hover tint", () => {
    const local = readAnnotatedCss(
      resolveAnnotatedCss(
        annotatedDirname(annotatedFilePath(import.meta.url)),
        "../src/reader/reader.css"
      ),
      "utf8"
    );
    expect(local).toMatch(
      /\.pdf-word:focus-visible\s*\{[^}]*background:\s*rgba\(236,\s*239,\s*230,\s*0\.55\);[^}]*\}/
    );
  });

  it("imports the withdrawal fragment and emits IPA and plain settled targets", async () => {
    const shared = readAnnotatedCss(
      resolveAnnotatedCss(
        annotatedDirname(annotatedFilePath(import.meta.url)),
        "../../../packages/reading-model/src/annotated-shared.css"
      ),
      "utf8"
    );
    const fragment = shared.match(
      /\/\* @shared lookup-word-hover \*\/([\s\S]*?)(?=\/\* @shared |$)/
    )?.[1];
    expect(fragment).toMatch(
      /\.lookup-word\.word-settled:hover,\s*\.ipa-word\.word-settled:hover\s*\{\s*background:\s*none;\s*\}/
    );
    const local = readAnnotatedCss(
      resolveAnnotatedCss(
        annotatedDirname(annotatedFilePath(import.meta.url)),
        "../src/reader/reader.css"
      ),
      "utf8"
    );
    expect(local).toMatch(
      /@import\s+"@lingualeaf\/reading-model\/annotated-shared\.css";/
    );
    const library = createMemoryLibraryStore();
    await library.saveDocument({
      id: "css-pins",
      title: "CSS pins",
      book: {
        title: "CSS pins",
        chapters: [
          {
            title: "CSS chapter",
            level: null,
            blocks: [
              {
                kind: "sentence",
                text: "Woke run book quiet.",
                ipaSlots: ["woʊk", "", "bʊk", ""],
              },
            ],
          },
        ],
      },
    });
    const memory = memoryBackend();
    memory.map.set("woke", "known");
    memory.map.set("run", "ignored");
    memory.map.set("book", "learning");
    renderWithSeams({
      library,
      store: createVocabularyStore(new OfflineDictionary(POPUP_DICT), memory),
    });
    fireEvent.click(await screen.findByRole("button", { name: "CSS pins" }));
    const section = await screen.findByRole("region", { name: "CSS chapter" });
    await waitFor(() => expect(wordEl("Woke")).toHaveClass("word-settled"));
    expect(
      [...section.querySelectorAll("[data-word]")].map((word) => word.className)
    ).toEqual([
      "ipa-word word-settled",
      "lookup-word word-settled",
      "ipa-word",
      "lookup-word",
    ]);
    expect(section.querySelectorAll(".ipa-word.word-settled")).toHaveLength(1);
    expect(section.querySelectorAll(".lookup-word.word-settled")).toHaveLength(
      1
    );
  });
});
