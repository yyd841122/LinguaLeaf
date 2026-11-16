import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { ReaderPage } from "../src/reader/ReaderPage";
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
  await screen.findByRole("heading", { name: "Readaloud Book" });
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

    // The button reads 暂停朗读 while playing.
    expect(
      screen.getByRole("button", { name: "暂停朗读" })
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

    fireEvent.click(screen.getByRole("button", { name: "暂停朗读" }));
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
