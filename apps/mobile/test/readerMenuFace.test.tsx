import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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
import {
  createMemoryUiSettingsStore,
  type UiSettingsStore,
} from "../src/store/ui-settings-store";
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

// Three sentences in one chapter: the anchor test's distinguishing
// geometry needs a third block between the candidate anchors.
const ANCHOR_EPUB = () =>
  buildEpub({
    title: "Anchor Book",
    docs: [
      {
        href: "text/one.xhtml",
        body: "<h1>Only Chapter</h1><p>First sentence stands high. Second sits between. Third lies below.</p>",
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
  file?: File,
  uiSettings: UiSettingsStore = createMemoryUiSettingsStore()
): Promise<{ learning: LearningSettingsStore; uiSettings: UiSettingsStore }> {
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
      uiSettings={uiSettings}
    />
  );
  await pickFile(
    file ??
      new File([(await SAMPLE_EPUB()) as BlobPart], "book.epub", {
        type: "application/epub+zip",
      })
  );
  await screen.findAllByRole("button", { name: /写笔记|编辑笔记/ });
  return { learning, uiSettings };
}

const openAa = async () => {
  await summonMenu();
  fireEvent.click(screen.getByRole("button", { name: "Aa" }));
  return screen.findByRole("dialog", { name: "排版与主题" });
};

const faceVar = (name: string): string => face().style.getPropertyValue(name);

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
    const { learning } = await openBook();
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

  it("the planted block is the walk's answer and idempotent across plants — the anchor is a menu-independent constant", async () => {
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
      new File([(await ANCHOR_EPUB()) as BlobPart], "book.epub", {
        type: "application/epub+zip",
      })
    );
    await screen.findAllByRole("button", { name: /写笔记|编辑笔记/ });
    // Three-way distinguishing geometry (the Codex review's probe): a
    // block above every candidate anchor, one at 90 (inside 96, outside
    // 0), one at 110 (inside head-geometry mutants, outside 96). The
    // constant-96 walk must pick block 1; an anchor-0 mutant picks 0, a
    // head-measured (~150) mutant picks 2.
    const blocks = [
      ...document.querySelectorAll<HTMLElement>("[data-block-index]"),
    ];
    expect(blocks.length).toBeGreaterThanOrEqual(3);
    blocks[0]!.getBoundingClientRect = () => rectAt(-300);
    blocks[1]!.getBoundingClientRect = () => rectAt(90);
    blocks[2]!.getBoundingClientRect = () => rectAt(110);

    await summonMenu();
    fireEvent.click(screen.getByRole("button", { name: "书签" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "在当前位置打书签" })
    );
    const rowsOpen = await bookmarks.list("doc:Anchor Book");
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
    expect(await bookmarks.list("doc:Anchor Book")).toHaveLength(1);
  });
});

describe("Aa 面板 — 排版档位与主题 (redesign 02)", () => {
  it("the ladders apply live through CSS vars and persist to ui-settings", async () => {
    const { uiSettings } = await openBook();
    await openAa();
    // Defaults per the reference image: 1.15rem / 22% / 1.75.
    expect(faceVar("--original-size")).toBe("1.15rem");
    expect(faceVar("--reader-margin")).toBe("22%");
    expect(faceVar("--reader-leading")).toBe("2");

    fireEvent.click(screen.getByRole("button", { name: "增大字号" }));
    expect(faceVar("--original-size")).toBe("1.3rem");
    fireEvent.click(screen.getByRole("button", { name: "减小字号" }));
    fireEvent.click(screen.getByRole("button", { name: "减小字号" }));
    expect(faceVar("--original-size")).toBe("1rem");
    expect(screen.getByRole("button", { name: "减小字号" })).toBeDisabled();

    fireEvent.click(screen.getByText("窄"));
    expect(faceVar("--reader-margin")).toBe("12%");

    fireEvent.click(screen.getByText("1.5"));
    // 音标 defaults ON: the kernel's double leading is the minimum
    // effective value — the ladder's 1.5 must NOT reach the line
    // (spec review finding 11).
    expect(faceVar("--reader-leading")).toBe("2");

    await waitFor(() =>
      expect(uiSettings.load()).resolves.toMatchObject({
        typography: { fontStep: 0, marginStep: 0, lineStep: 0 },
      })
    );
  });

  it("the ladder owns the pure-text line once 音标 is off", async () => {
    await openBook();
    await summonMenu();
    fireEvent.click(screen.getByRole("button", { name: "音标" }));
    await waitFor(() => expect(faceVar("--reader-leading")).toBe("1.75"));
    await openAa();
    fireEvent.click(screen.getByText("1.5"));
    expect(faceVar("--reader-leading")).toBe("1.5");
  });

  it("the theme picker switches <html data-theme> live and persists", async () => {
    const { uiSettings } = await openBook();
    await openAa();
    fireEvent.click(screen.getByRole("button", { name: "夜间" }));
    await waitFor(() =>
      expect(document.documentElement.dataset.theme).toBe("night")
    );
    await waitFor(() =>
      expect(uiSettings.load()).resolves.toMatchObject({ theme: "night" })
    );
    // No matchMedia in jsdom: 跟随系统 resolves light (暖纸).
    fireEvent.click(screen.getByRole("button", { name: "跟随系统" }));
    await waitFor(() =>
      expect(document.documentElement.dataset.theme).toBe("paper")
    );
  });

  it("the chapter opens with the centered number and the full-width title (仿参照图)", async () => {
    await openBook();
    expect(screen.getByText("第 1 章")).toBeInTheDocument();
    const opening = document.querySelector(".chapter-opening")!;
    expect(opening).not.toBeNull();
    expect(opening.querySelector(".chapter-title")?.textContent).toBe(
      "Chapter One"
    );
  });
});

describe("排版全组合矩阵 (redesign 02, jsdom 半场)", () => {
  // The wiring matrix: every 字号×边距×行距×音标×译文 combination must
  // land its own variable truth on the face without a render error. The
  // VISUAL half (不撞行不溢出,长音标词、窄屏) is real-device geometry —
  // ticket 04's 真机矩阵; jsdom cannot measure layout.
  it(
    "every combination lands its own vars and keeps the face mounted",
    { timeout: 60000 },
    async () => {
      await openBook();
      const readingFace = face();
      const FONTS = ["1rem", "1.15rem", "1.3rem", "1.45rem", "1.6rem"];
      const MARGINS = ["12%", "17%", "22%"];
      const LINES = ["1.5", "1.75", "2"];
      for (const ipa of [true, false]) {
        for (const translation of [true, false]) {
          // The bars carry both toggles; drive them to the target state.
          await summonMenu();
          const ipaButton = screen.getByRole("button", { name: "音标" });
          if (ipaButton.getAttribute("aria-pressed") !== String(ipa))
            fireEvent.click(ipaButton);
          const translationButton = screen.getByRole("button", {
            name: "译文",
          });
          if (
            translationButton.getAttribute("aria-pressed") !==
            String(translation)
          )
            fireEvent.click(translationButton);
          // The panel stays open while the ladders walk — every
          // combination asserts its own three vars.
          await openAa();
          for (const margin of MARGINS.keys()) {
            fireEvent.click(screen.getByText(["窄", "适中", "宽"][margin]!));
            for (const line of LINES.keys()) {
              fireEvent.click(screen.getByText(LINES[line]!));
              // Walk the font ladder down to 0 then up to 4, asserting at
              // every step (visits all five states wherever we started).
              for (let i = 0; i < 4; i++)
                fireEvent.click(
                  screen.getByRole("button", { name: "减小字号" })
                );
              for (const font of FONTS.keys()) {
                expect(faceVar("--original-size")).toBe(FONTS[font]);
                expect(faceVar("--reader-margin")).toBe(MARGINS[margin]);
                // 音标开: the kernel's double leading is the floor.
                expect(faceVar("--reader-leading")).toBe(
                  ipa ? "2" : LINES[line]
                );
                expect(readingFace.isConnected).toBe(true);
                if (font < 4)
                  fireEvent.click(
                    screen.getByRole("button", { name: "增大字号" })
                  );
              }
            }
          }
          fireEvent.click(screen.getByRole("button", { name: "关闭" }));
        }
      }
    }
  );
});

// PDF 双视图矩阵 (redesign 02): canvas and reflow each carry the
// menu/edge-flip/返回 contracts in their own suites — pdfReflow (the
// reflow face's menu, strip flips, 返回, zoom ladder visibility) and
// pdfReaderBookmarks/pdfReaderNotes (the canvas face's menu, strip
// flips, zoom steps, 返回). An empty describe would fail the run ("No
// test found in suite"), so the coverage map lives here in prose.

// PDF 双视图矩阵 (redesign 02): canvas and reflow each carry the
// menu/edge-flip/返回 contracts in their own suites — pdfReflow (the
// reflow face's menu, strip flips, 返回, zoom ladder visibility) and
// pdfReaderBookmarks/pdfReaderNotes (the canvas face's menu, strip
// flips, zoom steps, 返回). The contracts live where their harnesses
// are; a namesake test asserting nothing here would only stay green
// while that coverage rotted (the dual-axis review's hard finding).

describe("EPUB 目录面板 — 章节进度滑杆与重开位置 (redesign 02)", () => {
  it("the slider scrubs chapter indexes with the percent readout (评审 10)", async () => {
    await openBook();
    await summonMenu();
    fireEvent.click(screen.getByRole("button", { name: "目录" }));
    const dialog = await screen.findByRole("dialog", { name: "目录" });
    const slider = within(dialog).getByRole("slider", {
      name: "章节进度滑杆",
    });
    expect(slider).toHaveAttribute("min", "1");
    expect(slider).toHaveAttribute("max", "2");
    expect(slider).toHaveAttribute("value", "1");
    expect(within(dialog).getByText("50%")).toBeInTheDocument();
    fireEvent.change(slider, { target: { value: "2" } });
    expect(await screen.findByText("More")).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "目录" })).toBeNull();
  });

  it("menu open/close never moves the saved reading progress; a typography change survives the reopen", async () => {
    const library = createMemoryLibraryStore();
    const learning = createMemoryLearningSettingsStore();
    const uiSettings = createMemoryUiSettingsStore();
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
        learning={learning}
        uiSettings={uiSettings}
      />
    );
    await pickFile(
      new File([(await SAMPLE_EPUB()) as BlobPart], "book.epub", {
        type: "application/epub+zip",
      })
    );
    await screen.findAllByRole("button", { name: /写笔记|编辑笔记/ });
    const progressOf = async () =>
      (await library.exportProgress())["doc:Skeleton Book"];
    // Flip to chapter two (a progress fact), then toggle the menu both
    // ways: the saved progress must not flinch.
    fireEvent.click(screen.getByRole("button", { name: "下一章" }));
    await screen.findByText("More");
    const before = await progressOf();
    await summonMenu();
    await dismissMenu();
    await summonMenu();
    await dismissMenu();
    expect(await progressOf()).toEqual(before);
    // A typography pick persists and the reopened book returns to the
    // same chapter (排版调整后重开位置正确 — the parent spec's clause).
    await summonMenu();
    fireEvent.click(screen.getByRole("button", { name: "Aa" }));
    fireEvent.click(await screen.findByRole("button", { name: "增大字号" }));
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    await summonMenu();
    fireEvent.click(screen.getByRole("button", { name: "返回" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Skeleton Book" })
    );
    await screen.findAllByRole("button", { name: /写笔记|编辑笔记/ });
    expect(await screen.findByText("More")).toBeInTheDocument();
    expect(await progressOf()).toEqual(before);
    await summonMenu();
    expect(document.querySelector(".reader-menu-progress")?.textContent).toBe(
      "2 / 2"
    );
    // The non-zero-block half (the Codex review's gap): save a block-1
    // position under laid-out geometry, reopen, and observe the restore
    // scroll land ON that block — deleting the restore scroll reds here.
    const seen: HTMLElement[] = [];
    const spy = vi.fn(function (this: HTMLElement) {
      seen.push(this);
    });
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      value: spy,
      configurable: true,
      writable: true,
    });
    try {
      // Chapter ONE carries two sentence blocks (chapter two has one);
      // flip back so the saved block is genuinely non-zero.
      await dismissMenu();
      fireEvent.click(screen.getByRole("button", { name: "上一章" }));
      expect(await screen.findByText("Words")).toBeInTheDocument();
      const chapterBlocks = [
        ...document.querySelectorAll<HTMLElement>("[data-block-index]"),
      ];
      chapterBlocks[0]!.getBoundingClientRect = () =>
        ({ top: 500, bottom: 520 }) as DOMRect;
      chapterBlocks[1]!.getBoundingClientRect = () =>
        ({ top: -300, bottom: -280 }) as DOMRect;
      fireEvent.scroll(window);
      await waitFor(async () =>
        expect(await progressOf()).toMatchObject({
          chapterIndex: 0,
          blockIndex: 1,
        })
      );
      await summonMenu();
      fireEvent.click(screen.getByRole("button", { name: "返回" }));
      fireEvent.click(
        await screen.findByRole("button", { name: "Skeleton Book" })
      );
      await screen.findAllByRole("button", { name: /写笔记|编辑笔记/ });
      await waitFor(() => {
        expect(seen.at(-1)?.dataset.blockIndex).toBe("1");
      });
    } finally {
      Object.defineProperty(Element.prototype, "scrollIntoView", {
        value: undefined,
        configurable: true,
      });
    }
  });
});

describe("EPUB 滑杆脏稿守卫与翻带手势 (redesign 02, Codex 评审)", () => {
  it("the slider trips the abandon confirm like a chapter flip: refuse keeps the draft, accept jumps", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    try {
      await openBook();
      // The bars must predate the draft (the editor's capture guard owns
      // the surface while dirty); they stay up through the note flow.
      await summonMenu();
      fireEvent.click(screen.getAllByRole("button", { name: "写笔记" })[0]!);
      fireEvent.click(screen.getByRole("tab", { name: "疑问" }));
      fireEvent.change(screen.getByRole("textbox", { name: "笔记正文" }), {
        target: { value: "Unsaved" },
      });
      fireEvent.click(screen.getByRole("tab", { name: "进度" }));
      // The 目录 item itself carries the guard: refused, the panel never
      // opens and the draft lives.
      fireEvent.click(screen.getByRole("button", { name: "目录" }));
      expect(window.confirm).toHaveBeenCalledExactlyOnceWith("放弃修改？");
      expect(screen.getByRole("textbox")).toHaveValue("");
      fireEvent.click(screen.getByRole("tab", { name: "疑问" }));
      expect(screen.getByRole("textbox")).toHaveValue("Unsaved");
      fireEvent.click(screen.getByRole("tab", { name: "进度" }));
      // Accepted, the editor dies and the panel opens; the slider jumps
      // with NO further confirm.
      vi.mocked(window.confirm).mockReturnValue(true);
      fireEvent.click(screen.getByRole("button", { name: "目录" }));
      const slider = await screen.findByRole("slider", {
        name: "章节进度滑杆",
      });
      fireEvent.change(slider, { target: { value: "2" } });
      expect(window.confirm).toHaveBeenCalledTimes(2);
      expect(await screen.findByText("More")).toBeInTheDocument();
    } finally {
      confirm.mockRestore();
    }
  });

  it("an active selection kills a LIVE edge tap (选择文字期间禁翻)", async () => {
    await openBook();
    const line = document.querySelector(".original-line")!;
    const range = document.createRange();
    range.selectNodeContents(line);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    const edge = screen.getByRole("button", { name: "下一章" });
    fireEvent.pointerDown(edge, { clientX: 10, clientY: 10 });
    fireEvent.pointerUp(edge, { clientX: 10, clientY: 10 });
    fireEvent.click(edge);
    expect(screen.queryByText("More")).toBeNull();
  });

  it("a drifting drag or a pointercancel on the edge never flips; a clean tap does", async () => {
    await openBook();
    const edge = screen.getByRole("button", { name: "下一章" });
    fireEvent.pointerDown(edge, { clientX: 10, clientY: 10 });
    fireEvent.pointerMove(edge, { clientX: 40, clientY: 10 });
    fireEvent.pointerUp(edge, { clientX: 40, clientY: 10 });
    fireEvent.click(edge);
    expect(screen.queryByText("More")).toBeNull();
    fireEvent.pointerDown(edge, { clientX: 10, clientY: 10 });
    fireEvent.pointerCancel(edge);
    fireEvent.click(edge);
    expect(screen.queryByText("More")).toBeNull();
    fireEvent.pointerDown(edge, { clientX: 10, clientY: 10 });
    fireEvent.pointerUp(edge, { clientX: 10, clientY: 10 });
    fireEvent.click(edge);
    expect(await screen.findByText("More")).toBeInTheDocument();
  });
});

describe("EPUB 逐书开关 — 竞态与换书 (redesign 02, Codex 评审)", () => {
  it("a toggle made before the per-book read lands is never clobbered by the late answer", async () => {
    let release!: (value: { ipa: boolean; translation: boolean }) => void;
    const gate = new Promise<{ ipa: boolean; translation: boolean }>(
      (resolve) => {
        release = resolve;
      }
    );
    const learning: LearningSettingsStore = {
      load: () => gate,
      save: async () => undefined,
    };
    await openBook(learning);
    await summonMenu();
    fireEvent.click(screen.getByRole("button", { name: "音标" }));
    expect(screen.getByRole("button", { name: "音标" })).toHaveAttribute(
      "aria-pressed",
      "false"
    );
    await act(async () => {
      release({ ipa: true, translation: true });
    });
    expect(screen.getByRole("button", { name: "音标" })).toHaveAttribute(
      "aria-pressed",
      "false"
    );
  });

  it("the per-book read runs once per mount (the keys-in-deps lesson, bounded)", async () => {
    const learning = createMemoryLearningSettingsStore();
    const spy = vi.spyOn(learning, "load");
    await openBook(learning);
    await summonMenu();
    await dismissMenu();
    await summonMenu();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("different books keep different toggles across an A→B→A round trip", async () => {
    await openBook();
    await summonMenu();
    fireEvent.click(screen.getByRole("button", { name: "音标" }));
    fireEvent.click(screen.getByRole("button", { name: "返回" }));
    // B is a DIFFERENT title — same title would be the same docId.
    await pickFile(
      new File(
        [
          (await buildEpub({
            title: "Second Book",
            docs: [
              {
                href: "text/one.xhtml",
                body: "<h1>Only Chapter</h1><p>Another book entirely.</p>",
              },
            ],
          })) as BlobPart,
        ],
        "second.epub",
        { type: "application/epub+zip" }
      )
    );
    await screen.findAllByRole("button", { name: /写笔记|编辑笔记/ });
    await summonMenu();
    expect(screen.getByRole("button", { name: "音标" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
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
  });
});
