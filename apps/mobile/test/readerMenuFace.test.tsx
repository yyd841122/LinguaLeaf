import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ReaderPage } from "../src/reader/ReaderPage";
import { dismissMenu, summonMenu } from "./reader-picker";
import { buildEpub } from "@lingualeaf/import-core/testing";
import { createChapterTaskRegistry } from "../src/translate/chapter-tasks";
import { createMemoryTranslateSettingsStore } from "../src/store/translate-settings-store";
import { createMemoryTranslationStore } from "../src/store/translation-store";
import { createMemoryLibraryStore } from "../src/store/library-store";
import { createMemoryNotesStore } from "../src/store/notes-store";
import { createMemoryPdfNotesStore } from "../src/store/pdf-notes-store";
import { createMemoryPdfPositionStore } from "../src/store/pdf-position-store";
import { createMemoryBookmarkStore } from "../src/store/bookmark-store";
import {
  createPdfBytesStore,
  createMemoryPdfBytesBackend,
} from "../src/store/idb-bytes-store";
import {
  createVocabularyStore,
  memoryBackend,
} from "../src/store/vocabulary-store";
import {
  createMemoryLearningSettingsStore,
  type LearningSettingsStore,
} from "../src/store/learning-settings-store";
import { OfflineDictionary } from "../src/dict/offline-dictionary";

// Redesign 02's EPUB interaction slice: the summonable menu, the tap
// zones' priority rule, the per-book learning toggles, and the anchor's
// independence from the menu's geometry (the ticket's acceptance gates).

const FIXTURE_DICT = { ipa: { woke: "woʊk" }, inflections: {}, entries: {} };

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
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  fireEvent.change(input);
}

const face = () =>
  document.querySelector("main.reader:not(.reader-entry)") as HTMLElement;

async function openBook(
  learning: LearningSettingsStore = createMemoryLearningSettingsStore(),
  file?: File
): Promise<LearningSettingsStore> {
  render(
    <ReaderPage
      store={createVocabularyStore(
        new OfflineDictionary(FIXTURE_DICT),
        memoryBackend()
      )}
      library={createMemoryLibraryStore()}
      notes={createMemoryNotesStore()}
      pdfNotes={createMemoryPdfNotesStore()}
      pdfPositions={createMemoryPdfPositionStore()}
      pdfBytes={createPdfBytesStore(createMemoryPdfBytesBackend())}
      translations={createMemoryTranslationStore()}
      settings={createMemoryTranslateSettingsStore()}
      bookmarks={createMemoryBookmarkStore()}
      registry={createChapterTaskRegistry()}
      learning={learning}
    />
  );
  await pickFile(
    file ??
      new File([(await SAMPLE_EPUB()) as BlobPart], "book.epub", {
        type: "application/epub+zip",
      })
  );
  await screen.findAllByRole("button", { name: /写笔记|编辑笔记/ });
  return learning;
}

const menuBars = () =>
  ({
    top: document.querySelector(".reader-menu-top"),
    bottom: document.querySelector(".reader-menu-bottom"),
  }) as const;

afterEach(() => {
  const selection = window.getSelection();
  selection?.removeAllRanges();
});

describe("EPUB menu + tap zones (redesign 02)", () => {
  it("the reading face carries zero resident chrome until a background tap summons the bars; a second tap dismisses", async () => {
    await openBook();
    expect(menuBars().top).toBeNull();
    expect(menuBars().bottom).toBeNull();
    await summonMenu();
    expect(menuBars().top).not.toBeNull();
    expect(menuBars().bottom).not.toBeNull();
    expect(screen.getByRole("button", { name: "返回" })).toBeInTheDocument();
    await dismissMenu();
    expect(menuBars().top).toBeNull();
    expect(menuBars().bottom).toBeNull();
  });

  it("词 beats 菜单背景点 — a word tap opens the lookup popup, never the menu", async () => {
    await openBook();
    fireEvent.click(screen.getByText("Words"));
    await screen.findByRole("dialog", { name: /词详情/ });
    // The word's tap must not have summoned the bars on the side.
    expect(menuBars().top).toBeNull();
  });

  it("an active text selection never summons the menu (选择文字期间禁翻禁呼出)", async () => {
    await openBook();
    const line = document.querySelector(".original-line")!;
    const range = document.createRange();
    range.selectNodeContents(line);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    fireEvent.click(face());
    expect(menuBars().top).toBeNull();
  });

  it("the edge strips flip chapters and respect the book's ends", async () => {
    await openBook();
    expect(screen.getByRole("button", { name: "上一章" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "下一章" }));
    expect(await screen.findByText("More")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "下一章" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "上一章" }));
    expect(await screen.findByText("Words")).toBeInTheDocument();
  });

  it("the menu's own items stay tappable: a panel opens and closes back to the hidden state", async () => {
    await openBook();
    await summonMenu();
    fireEvent.click(screen.getByRole("button", { name: "目录" }));
    expect(
      await screen.findByRole("dialog", { name: "目录" })
    ).toBeInTheDocument();
    expect(menuBars().top).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(screen.queryByRole("dialog", { name: "目录" })).toBeNull();
  });
});

describe("EPUB 逐书学习开关 (redesign 02)", () => {
  it("each book remembers its own toggles across a shelf round-trip; a fresh book keeps the defaults", async () => {
    const learning = await openBook();
    await summonMenu();
    fireEvent.click(screen.getByRole("button", { name: "音标" }));
    await waitFor(() =>
      expect(document.querySelectorAll(".ipa-word-ipa")).toHaveLength(0)
    );
    await summonMenu();
    fireEvent.click(screen.getByRole("button", { name: "译文" }));

    // 返回 to the shelf, reopen the same book: both flips survived.
    fireEvent.click(screen.getByRole("button", { name: "返回" }));
    await pickFile(
      new File([(await SAMPLE_EPUB()) as BlobPart], "book.epub", {
        type: "application/epub+zip",
      })
    );
    await screen.findAllByRole("button", { name: /写笔记|编辑笔记/ });
    await summonMenu();
    expect(screen.getByRole("button", { name: "音标" })).toHaveAttribute(
      "aria-pressed",
      "false"
    );
    expect(screen.getByRole("button", { name: "译文" })).toHaveAttribute(
      "aria-pressed",
      "false"
    );
    expect(await learning.load("doc:Skeleton Book")).toEqual({
      ipa: false,
      translation: false,
    });
  });

  it("the toggles default on (the old global values) for a book with no record", async () => {
    const learning = createMemoryLearningSettingsStore();
    await openBook(learning);
    await summonMenu();
    expect(screen.getByRole("button", { name: "音标" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(screen.getByRole("button", { name: "译文" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
  });
});

describe("EPUB anchor independence (redesign 02 acceptance)", () => {
  const rectAt = (top: number): DOMRect =>
    ({
      top,
      bottom: top + 20,
      left: 0,
      right: 300,
      width: 300,
      height: 20,
      x: 0,
      y: top,
      toJSON: () => ({}),
    }) as DOMRect;

  it("the planted bookmark's block is the same with the menu hidden and with it open", async () => {
    const bookmarks = createMemoryBookmarkStore();
    const learning = createMemoryLearningSettingsStore();
    render(
      <ReaderPage
        store={createVocabularyStore(
          new OfflineDictionary(FIXTURE_DICT),
          memoryBackend()
        )}
        library={createMemoryLibraryStore()}
        notes={createMemoryNotesStore()}
        pdfNotes={createMemoryPdfNotesStore()}
        pdfPositions={createMemoryPdfPositionStore()}
        pdfBytes={createPdfBytesStore(createMemoryPdfBytesBackend())}
        translations={createMemoryTranslationStore()}
        settings={createMemoryTranslateSettingsStore()}
        bookmarks={bookmarks}
        registry={createChapterTaskRegistry()}
        learning={learning}
      />
    );
    await pickFile(
      new File([(await SAMPLE_EPUB()) as BlobPart], "book.epub", {
        type: "application/epub+zip",
      })
    );
    await screen.findAllByRole("button", { name: /写笔记|编辑笔记/ });
    // Block 0 sits below the constant anchor, block 1 above it: the
    // walk must land on block 1 whatever the menu's geometry.
    const blocks = [
      ...document.querySelectorAll<HTMLElement>("[data-block-index]"),
    ];
    blocks[0]!.getBoundingClientRect = () => rectAt(500);
    blocks[1]!.getBoundingClientRect = () => rectAt(-300);

    await summonMenu();
    fireEvent.click(screen.getByRole("button", { name: "书签" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "在当前位置打书签" })
    );
    const rowsOpen = await bookmarks.list("doc:Skeleton Book");
    expect(rowsOpen).toHaveLength(1);
    expect(rowsOpen[0]).toMatchObject({ chapter: 0, block: 1 });
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));

    // Same geometry, menu hidden: the same-position replant is ONE row
    // (the store's idempotence) — the menu changed nothing.
    await summonMenu();
    fireEvent.click(screen.getByRole("button", { name: "书签" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "在当前位置打书签" })
    );
    expect(await bookmarks.list("doc:Skeleton Book")).toHaveLength(1);
  });
});
