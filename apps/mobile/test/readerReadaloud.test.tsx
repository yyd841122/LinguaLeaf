import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { ReaderPage } from "../src/reader/ReaderPage";
import { summonMenu } from "./reader-picker";
import { buildEpub } from "@lingualeaf/import-core/testing";
import { createChapterTaskRegistry } from "../src/translate/chapter-tasks";
import { createMemoryTranslateSettingsStore } from "../src/store/translate-settings-store";
import { createMemoryBookmarkStore } from "../src/store/bookmark-store";
import { createMemoryTranslationStore } from "../src/store/translation-store";
import {
  createMemoryLibraryStore,
  type LibraryStore,
} from "../src/store/library-store";
import { createMemoryNotesStore } from "../src/store/notes-store";
import { createMemoryPdfNotesStore } from "../src/store/pdf-notes-store";
import { createMemoryPdfPositionStore } from "../src/store/pdf-position-store";
import {
  createMemoryPdfBytesBackend,
  createPdfBytesStore,
} from "../src/store/idb-bytes-store";
import {
  createVocabularyStore,
  memoryBackend,
} from "../src/store/vocabulary-store";
import { OfflineDictionary } from "../src/dict/offline-dictionary";
import type { ReadAloudSpeaker } from "../src/speak/readaloud";
import { SpeakRejectionError } from "../src/speak/speak-failure";

// The 听书 face wiring (ticket 07): the EPUB face's control bar drives
// the player, the live sentence carries the highlight, each completed
// sentence writes the reading position through the library seam, and a
// classified failure renders as the bar's own alert. The fake speaker's
// deferred promises ARE the sentence boundaries.

const FIXTURE_DICT = { ipa: { woke: "woʊk" }, inflections: {}, entries: {} };

const SAMPLE_EPUB = () =>
  buildEpub({
    title: "Readaloud Book",
    docs: [
      {
        href: "text/one.xhtml",
        body: "<h1>Chapter One</h1><p>Woke on the page. A second sentence follows.</p>",
      },
      {
        href: "text/two.xhtml",
        body: "<h2>Chapter Two</h2><p>More words live here.</p>",
      },
    ],
  });

function fakeSpeaker() {
  type Pending = { resolve: () => void; reject: (error: Error) => void };
  const pending: Pending[] = [];
  const calls: { text: string; rate?: number }[] = [];
  let stopCalls = 0;
  const speaker: ReadAloudSpeaker = {
    speak(text: string, _lang: string, rate?: number) {
      calls.push(rate === undefined ? { text } : { text, rate });
      return new Promise<void>((resolve, reject) =>
        pending.push({ resolve, reject })
      );
    },
    stop() {
      stopCalls += 1;
      pending.splice(0).forEach((utterance) => utterance.resolve());
      return Promise.resolve();
    },
  };
  return {
    speaker,
    calls,
    stopCalls: () => stopCalls,
    resolve() {
      pending.splice(0, 1)[0]?.resolve();
    },
    reject(error: Error) {
      pending.splice(0, 1)[0]?.reject(error);
    },
  };
}

async function renderFace(speaker: ReadAloudSpeaker, library: LibraryStore) {
  render(
    <ReaderPage
      store={createVocabularyStore(
        new OfflineDictionary(FIXTURE_DICT),
        memoryBackend()
      )}
      library={library}
      notes={createMemoryNotesStore()}
      pdfNotes={createMemoryPdfNotesStore()}
      pdfPositions={createMemoryPdfPositionStore()}
      pdfBytes={createPdfBytesStore(createMemoryPdfBytesBackend())}
      translations={createMemoryTranslationStore()}
      settings={createMemoryTranslateSettingsStore()}
      bookmarks={createMemoryBookmarkStore()}
      registry={createChapterTaskRegistry()}
      readAloudSpeaker={speaker}
    />
  );
  const input = document.querySelector(
    'input[type="file"]'
  ) as HTMLInputElement;
  Object.defineProperty(input, "files", {
    value: [new File([(await SAMPLE_EPUB()) as BlobPart], "book.epub")],
    configurable: true,
  });
  fireEvent.change(input);
  // Redesign 02: the resident 听书 row became the menu's 二级面板 —
  // summon the bars and open the panel once; its controls stay put.
  await screen.findAllByRole("button", { name: /写笔记|编辑笔记/ });
  await summonMenu();
  fireEvent.click(screen.getByRole("button", { name: "听书" }));
  await screen.findByRole("dialog", { name: "听书" });
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  vi.unstubAllGlobals();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("EPUB face 听书 (ticket 07)", () => {
  it("plays from the chapter's first sentence: highlight, progress, advance", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) => {
        const url = String(input);
        if (url.includes("dictionary.json")) {
          return {
            ok: true,
            json: async () => FIXTURE_DICT,
          } as unknown as Response;
        }
        throw new Error(`unexpected fetch: ${url}`);
      })
    );
    const fake = fakeSpeaker();
    const library = createMemoryLibraryStore();
    await renderFace(fake.speaker, library);

    fireEvent.click(screen.getByRole("button", { name: "听书" }));
    await waitFor(() => expect(fake.calls.length).toBe(1));
    expect(fake.calls[0]?.text).toBe("Woke on the page.");
    // The live sentence carries the highlight; the next does not.
    expect(
      document.querySelector("[data-block-index='0']")?.classList
    ).toContain("reading-aloud");

    fake.resolve();
    await tick();
    // The completed sentence wrote the reading position (D6)…
    expect(await library.exportProgress()).toEqual({
      "doc:Readaloud Book": { chapterIndex: 0, blockIndex: 0 },
    });
    // …and the walk is on the chapter's second sentence.
    expect(fake.calls[1]?.text).toBe("A second sentence follows.");
    // While the walk owns the position, a scroll must not write over it
    // (the two writers would flap) — the player's last write stands.
    fireEvent.scroll(window);
    await tick();
    expect(await library.exportProgress()).toEqual({
      "doc:Readaloud Book": { chapterIndex: 0, blockIndex: 0 },
    });
    await waitFor(() =>
      expect(
        document.querySelector("[data-block-index='1']")?.classList
      ).toContain("reading-aloud")
    );
    expect(
      document.querySelector("[data-block-index='0']")?.classList
    ).not.toContain("reading-aloud");

    // The button reads 暂停听书 while playing.
    expect(
      screen.getByRole("button", { name: "暂停听书" })
    ).toBeInTheDocument();
  });

  it("pause holds the sentence; a cross-chapter sentence flips the face", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) => {
        const url = String(input);
        if (url.includes("dictionary.json")) {
          return {
            ok: true,
            json: async () => FIXTURE_DICT,
          } as unknown as Response;
        }
        throw new Error(`unexpected fetch: ${url}`);
      })
    );
    const fake = fakeSpeaker();
    const library = createMemoryLibraryStore();
    await renderFace(fake.speaker, library);

    fireEvent.click(screen.getByRole("button", { name: "听书" }));
    await waitFor(() => expect(fake.calls.length).toBe(1));
    // Run to the end of chapter one (two sentences), landing on
    // chapter two's only sentence.
    fake.resolve();
    await tick();
    fake.resolve();
    await tick();
    await waitFor(() =>
      expect(fake.calls.at(-1)?.text).toBe("More words live here.")
    );
    // The face followed the walk across the chapter boundary.
    await screen.findByText("More");

    fireEvent.click(screen.getByRole("button", { name: "暂停听书" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "听书" })).toBeInTheDocument()
    );
    expect(fake.stopCalls()).toBe(1);
    // The highlight holds the paused sentence.
    expect(document.querySelector(".reading-aloud")?.textContent).toContain(
      "More words live here."
    );
  });

  it("a missing engine renders the bar's alert; the rate ladder cycles", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) => {
        const url = String(input);
        if (url.includes("dictionary.json")) {
          return {
            ok: true,
            json: async () => FIXTURE_DICT,
          } as unknown as Response;
        }
        throw new Error(`unexpected fetch: ${url}`);
      })
    );
    const fake = fakeSpeaker();
    const library = createMemoryLibraryStore();
    await renderFace(fake.speaker, library);

    // The rate ladder cycles its label; while idle it just records.
    fireEvent.click(screen.getByRole("button", { name: /语速 1×/ }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /语速 1.25×/ }))
    );

    fireEvent.click(screen.getByRole("button", { name: "听书" }));
    await waitFor(() => expect(fake.calls.length).toBe(1));
    fake.reject(new SpeakRejectionError("engine-missing"));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("听书不可用");
    // The walk retired: the button reads 听书 again.
    expect(screen.getByRole("button", { name: "听书" })).toBeInTheDocument();
    // A fresh attempt clears the flag first (the arm-side clear).
    fake.resolve();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "听书" }));
    });
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });
});

// The review's P2s on navigation: manual chapter moves must not fight
// the walk's progress ownership, and paused steps across the chapter
// boundary must still present their target.
describe("EPUB face 听书 — navigation races (07 review)", () => {
  it("a manual chapter move while playing leaves the walk owning progress", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) => {
        const url = String(input);
        if (url.includes("dictionary.json")) {
          return {
            ok: true,
            json: async () => FIXTURE_DICT,
          } as unknown as Response;
        }
        throw new Error(`unexpected fetch: ${url}`);
      })
    );
    const fake = fakeSpeaker();
    const library = createMemoryLibraryStore();
    await renderFace(fake.speaker, library);

    // Play from the panel, then close it — the edge strips exist only
    // with no menu and no panel up (redesign 02).
    fireEvent.click(screen.getByRole("button", { name: "听书" }));
    await waitFor(() => expect(fake.calls.length).toBe(1));
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    // Walk holds chapter one's first sentence; the reader taps 下一章.
    // The follow effect pulls the face back to the walk's chapter
    // (possibly within the same commit — the transient chapter-two
    // view is not observable); the assertion that matters: the saved
    // progress is NOT stranded at chapter two's top.
    fireEvent.click(screen.getByRole("button", { name: "下一章" }));
    // The face is back on the walk's chapter (the summoned menu's
    // progress names it; the sentence text is split across word spans).
    await summonMenu();
    await waitFor(() =>
      expect(document.querySelector(".reader-menu-progress")?.textContent).toBe(
        "1 / 2"
      )
    );
    // The held sentence has not completed — the walk has written nothing;
    // the manual move must not strand progress at chapter two's top
    // (the guard's mutant writes exactly { chapterIndex: 1, blockIndex: 0 }).
    expect(Object.values(await library.exportProgress())).not.toContainEqual({
      chapterIndex: 1,
      blockIndex: 0,
    });
  });

  it("a paused step across the chapter boundary presents its target", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) => {
        const url = String(input);
        if (url.includes("dictionary.json")) {
          return {
            ok: true,
            json: async () => FIXTURE_DICT,
          } as unknown as Response;
        }
        throw new Error(`unexpected fetch: ${url}`);
      })
    );
    const fake = fakeSpeaker();
    const library = createMemoryLibraryStore();
    await renderFace(fake.speaker, library);

    // Play through chapter one; the walk lands on chapter two's only
    // sentence; pause there, then step BACK across the boundary.
    fireEvent.click(screen.getByRole("button", { name: "听书" }));
    await waitFor(() => expect(fake.calls.length).toBe(1));
    fake.resolve();
    await tick();
    fake.resolve();
    await tick();
    await waitFor(() =>
      expect(fake.calls.at(-1)?.text).toBe("More words live here.")
    );
    await screen.findByText("More");
    fireEvent.click(screen.getByRole("button", { name: "暂停听书" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "听书" })).toBeInTheDocument()
    );
    fireEvent.click(screen.getByRole("button", { name: "上一句" }));
    // The panel's veil owns the surface while it is up — close it
    // before summoning the bars (弹窗 > 菜单背景点).
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));

    // The paused cursor is back in chapter one: the face followed it
    // (not stuck on chapter two) and its sentence carries the highlight.
    // (The menu's progress readout names the chapter; the sentence text
    // itself is split across word spans.)
    await summonMenu();
    await waitFor(() =>
      expect(document.querySelector(".reader-menu-progress")?.textContent).toBe(
        "1 / 2"
      )
    );
    await waitFor(() =>
      expect(
        document.querySelector("[data-block-index='1']")?.classList
      ).toContain("reading-aloud")
    );
  });
});
