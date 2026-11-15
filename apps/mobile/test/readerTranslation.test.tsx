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
import { createMemoryTranslationStore } from "../src/store/translation-store";
import { createMemoryLibraryStore } from "../src/store/library-store";
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

// The on-demand translation face (mobile-app ticket 04): the reader
// triggers per-chapter translation, watches the percent on the trigger
// button, reads 译文行 under the original lines, hides them with the
// 译文 显示开关, and gets a readable flag when a chapter settles with
// nothing translated (wrong key, network down — the acceptance's two
// failure shots). The DeepSeek endpoint is stubbed at the fetch boundary;
// the real loopback pipeline is pinned by deepseekMockSmoke.test.ts.

const FIXTURE_DICT = {
  ipa: { woke: "woʊk", words: "wɜːdz" },
  inflections: {},
  entries: {},
};

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

type ChatReply = { status: number; content?: string };

// One fetch stub for every fetcher the page meets: the baked dictionary
// asset and the chat completions endpoint. The chat handler is the test's
// script — a reply object, a promise (held gates), or a throw (network
// down). An unmatched request throws naming the URL (CODING_STANDARDS:
// a stub gap must not read as a domain failure).
function stubFetch(
  chat: (body: unknown) => Promise<ChatReply> | ChatReply
): void {
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
      if (url.includes("/chat/completions")) {
        const reply = await chat({
          model: "deepseek-flash",
          messages: [],
        });
        if (reply.status !== 200) {
          return new Response("upstream exploded", { status: reply.status });
        }
        return new Response(
          JSON.stringify({
            choices: [
              {
                finish_reason: "stop",
                message: { role: "assistant", content: reply.content ?? "" },
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      throw new Error(`unexpected fetch: ${url}`);
    })
  );
}

async function pickFile(file: File): Promise<void> {
  const input = document.querySelector(
    'input[type="file"]'
  ) as HTMLInputElement;
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  fireEvent.change(input);
}

async function renderReadingFace(options?: {
  settingsApiKey?: string;
}): Promise<void> {
  const settings = createMemoryTranslateSettingsStore();
  if (options?.settingsApiKey !== undefined) {
    await settings.save({
      apiKey: options.settingsApiKey,
      baseUrl: "http://mock.local",
      model: "deepseek-flash",
    });
  }
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
      settings={settings}
      registry={createChapterTaskRegistry()}
    />
  );
  await pickFile(
    new File([(await SAMPLE_EPUB()) as BlobPart], "book.epub", {
      type: "application/epub+zip",
    })
  );
  await screen.findByRole("heading", { name: "Skeleton Book" });
  // The trigger's disabled state reads the runtime settings — the face
  // mounts before that read lands, so wait for the settled fact: enabled
  // with a key, the hint without one.
  if (options?.settingsApiKey !== undefined) {
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "翻译" })).toBeEnabled()
    );
  } else {
    await screen.findByText(/未配置翻译/);
  }
}

const translationLines = (): string[] =>
  [...document.querySelectorAll(".translation-line")].map(
    (el) => el.textContent ?? ""
  );

beforeEach(() => {
  vi.unstubAllGlobals();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ReaderPage — 按需翻译 (ticket 04)", () => {
  it("walks the percent on the trigger, lands 译文行, and keeps them across chapter switches", async () => {
    let release!: (value: ChatReply) => void;
    const gate = new Promise<ChatReply>((resolve) => {
      release = resolve;
    });
    stubFetch(() => gate);

    await renderReadingFace({ settingsApiKey: "sk-test" });

    // The trigger arms the task at once: the button flips to the running
    // label and locks (the lifecycle owns the disabled state — not a
    // response arriving).
    const trigger = screen.getByRole("button", { name: "翻译" });
    fireEvent.click(trigger);
    expect(screen.getByRole("button", { name: "翻译中 0%" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "翻译" })).toBeNull();

    release({ status: 200, content: "1. 第一句的译文。\n2. 第二句的译文。" });

    expect(await screen.findByText("第一句的译文。")).toBeInTheDocument();
    expect(translationLines()).toEqual(["第一句的译文。", "第二句的译文。"]);
    // Settled: the trigger reads 已翻译 and stays locked — a translated
    // chapter is final (the server's same shape).
    expect(screen.getByRole("button", { name: "已翻译" })).toBeDisabled();

    // The store persists the chapter's lines: away and back, still there.
    // The list lives behind 目录 (真机 md round 3): open the overlay first.
    fireEvent.click(screen.getByRole("button", { name: "目录" }));
    fireEvent.click(screen.getByRole("button", { name: "Chapter Two" }));
    expect(await screen.findByText("More")).toBeInTheDocument();
    expect(translationLines()).toEqual([]);
    // The pager carries the way back (the chapter list rides the entry
    // chapter only, 真机 md round 2).
    fireEvent.click(screen.getByRole("button", { name: "上一章" }));
    expect(await screen.findByText("第一句的译文。")).toBeInTheDocument();
    expect(translationLines()).toEqual(["第一句的译文。", "第二句的译文。"]);
  });

  it("the 译文 显示开关 hides and restores the lines", async () => {
    stubFetch(() => ({
      status: 200,
      content: "1. 第一句的译文。\n2. 第二句的译文。",
    }));
    await renderReadingFace({ settingsApiKey: "sk-test" });

    fireEvent.click(screen.getByRole("button", { name: "翻译" }));
    expect(await screen.findByText("第一句的译文。")).toBeInTheDocument();

    // Settled lines show by default (the 音标 toggle's same posture).
    const toggle = screen.getByRole("button", { name: "译文" });
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(translationLines()).toEqual(["第一句的译文。", "第二句的译文。"]);
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(translationLines()).toEqual([]);
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(translationLines()).toEqual(["第一句的译文。", "第二句的译文。"]);
  });

  it("a wrong key settles failed: a readable flag, a retryable trigger, nothing rendered", async () => {
    stubFetch(() => ({ status: 401 }));
    await renderReadingFace({ settingsApiKey: "sk-wrong" });

    fireEvent.click(screen.getByRole("button", { name: "翻译" }));

    const flag = await screen.findByRole("alert");
    expect(flag.textContent).toContain("翻译失败");
    expect(flag.textContent).toContain("设置");
    // Nothing landed: no lines, and the trigger is back — the retry path.
    expect(translationLines()).toEqual([]);
    expect(screen.getByRole("button", { name: "翻译" })).toBeEnabled();

    // The flag stays until dismissed (credibility: it cannot self-vanish).
    fireEvent.click(screen.getByRole("button", { name: "关闭翻译提示" }));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("a network outage settles failed the same readable way", async () => {
    stubFetch(() => {
      throw new TypeError("fetch failed: network down");
    });
    await renderReadingFace({ settingsApiKey: "sk-test" });

    fireEvent.click(screen.getByRole("button", { name: "翻译" }));

    const flag = await screen.findByRole("alert");
    expect(flag.textContent).toContain("翻译失败");
    expect(screen.getByRole("button", { name: "翻译" })).toBeEnabled();
  });

  it("without a key the trigger is locked with a hint (ADR-0004: 置灰加提示)", async () => {
    const chat = vi.fn(() => ({ status: 200, content: "1. 译。" }));
    stubFetch(chat);
    await renderReadingFace();

    const trigger = screen.getByRole("button", { name: "翻译" });
    expect(trigger).toBeDisabled();
    expect(screen.getByText(/未配置翻译/)).toBeInTheDocument();
    fireEvent.click(trigger);
    // Locked means locked: no request ever left.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(chat).not.toHaveBeenCalled();
  });

  it("re-entering a chapter mid-task shows the running percent again", async () => {
    let release!: (value: ChatReply) => void;
    const gate = new Promise<ChatReply>((resolve) => {
      release = resolve;
    });
    stubFetch(() => gate);
    await renderReadingFace({ settingsApiKey: "sk-test" });

    fireEvent.click(screen.getByRole("button", { name: "翻译" }));
    expect(screen.getByRole("button", { name: "翻译中 0%" })).toBeDisabled();

    // Away to chapter two, where the task is not running; the trigger
    // there is a fresh, armed 翻译.
    // The list lives behind 目录 (真机 md round 3): open the overlay first.
    fireEvent.click(screen.getByRole("button", { name: "目录" }));
    fireEvent.click(screen.getByRole("button", { name: "Chapter Two" }));
    expect(await screen.findByRole("button", { name: "翻译" })).toBeEnabled();
    // Back to chapter one via the pager (the chapter list rides the
    // entry chapter only, 真机 md round 2): the running task is visible
    // again (the registry replays its percent to the re-armed
    // subscription).
    fireEvent.click(screen.getByRole("button", { name: "上一章" }));
    expect(
      await screen.findByRole("button", { name: "翻译中 0%" })
    ).toBeDisabled();

    release({ status: 200, content: "1. 第一句的译文。\n2. 第二句的译文。" });
    expect(await screen.findByText("第一句的译文。")).toBeInTheDocument();
  });

  it("the settings overlay opens from the reading face and saving a key re-arms the trigger", async () => {
    stubFetch(() => ({ status: 200, content: "1. 译。" }));
    await renderReadingFace();

    // Unconfigured: locked with the hint.
    expect(screen.getByRole("button", { name: "翻译" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "设置" }));
    const dialog = await screen.findByRole("dialog", { name: "翻译设置" });
    expect(dialog).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("API Key"), {
      target: { value: "sk-late" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await screen.findByText("已保存");
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));

    // The reader face never remounted, yet the trigger re-read its
    // settings: no reload, no lost state — the revision rides the close.
    expect(await screen.findByRole("button", { name: "翻译" })).toBeEnabled();
    expect(screen.queryByRole("dialog", { name: "翻译设置" })).toBeNull();
  });
});
