import { PICKER_LABEL } from "./reader-picker";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { buildEpub } from "@lingualeaf/import-core/testing";
import { App } from "../src/App";
import { OfflineDictionary } from "../src/dict/offline-dictionary";
import {
  createMemoryPdfBytesBackend,
  createPdfBytesStore,
} from "../src/store/idb-bytes-store";
import type { ExtBook } from "../src/reader/import-book";
import { createMemoryLibraryStore } from "../src/store/library-store";
import { createMemoryTranslationStore } from "../src/store/translation-store";
import { createMemoryNotesStore } from "../src/store/notes-store";
import { createMemoryPdfNotesStore } from "../src/store/pdf-notes-store";
import { createMemoryPdfPositionStore } from "../src/store/pdf-position-store";
import {
  createVocabularyStore,
  memoryBackend,
} from "../src/store/vocabulary-store";
import { createStorageBackend } from "../src/store/vocabulary-store";
import { createIdbNamespaceStorage } from "../src/store/idb-namespace-storage";

// 书架换装验收面(票 02):启动即落在 ReaderPage 的 landing —— 应用名
// 可见、文件选择入口可见,recents 随库内容走。注入 memory 后端让 jsdom
// 不碰 IndexedDB;组件内部怎么排版本测试不关心。持久化提示等浏览器
// 文案由真机人验裁决,测试不断言。
const BOOK = (title: string): ExtBook => ({
  title,
  chapters: [
    {
      title: "One",
      level: 1,
      blocks: [{ kind: "sentence", text: "Words.", ipaSlots: [""] }],
    },
  ],
});
const EMPTY_DICTIONARY = new OfflineDictionary({
  ipa: {},
  inflections: {},
  entries: {},
});

async function renderApp(library = createMemoryLibraryStore()) {
  render(
    <App
      store={createVocabularyStore(EMPTY_DICTIONARY, memoryBackend())}
      translations={createMemoryTranslationStore()}
      library={library}
      notes={createMemoryNotesStore()}
      pdfNotes={createMemoryPdfNotesStore()}
      pdfPositions={createMemoryPdfPositionStore()}
      pdfBytes={createPdfBytesStore(createMemoryPdfBytesBackend())}
    />
  );
  return library;
}

test("启动落在阅读页书架:应用名与文件选择入口可见", async () => {
  await renderApp();
  expect(
    screen.getByRole("heading", { level: 1, name: "LinguaLeaf" })
  ).toBeVisible();
  expect(screen.getByLabelText(PICKER_LABEL)).toBeInTheDocument();
});

test("库里有书时 recents 列出书名与章进度", async () => {
  const library = createMemoryLibraryStore();
  await library.saveDocument({
    id: "doc:Seeded",
    title: "Seeded Book",
    book: BOOK("Seeded Book"),
  });
  await renderApp(library);
  const recents = await screen.findByRole("navigation", {
    name: "最近文档",
  });
  expect(recents).toBeVisible();
  expect(screen.getByRole("button", { name: "Seeded Book" })).toBeVisible();
  // 重开用 hint 标进度:第 N 章(从 1 数)。
  expect(screen.getByText("第 1 章")).toBeVisible();
});

// The "empty" pin rides on the previous test's presence case: that test
// renders the same nav into the document from a seeded store, so this
// absence distinguishes a library-driven nav from an always-rendered one.
test("空库不渲染 recents(recents 读取落定后断言)", async () => {
  await renderApp();
  await waitFor(() =>
    expect(
      screen.queryByRole("navigation", { name: "最近文档" })
    ).not.toBeInTheDocument()
  );
});

// mobile-app 02 终审证据缺口①的组合根半边: zero injections — the page
// must root the REAL IndexedDB-backed vocabulary store, not the memory
// twin. A state seeded through the real backend must surface on the
// face (the tint walk), and a state set through the popup must survive
// the mount's death (killed app, fresh mount over the same database):
// swapping the composition root to a per-mount memory backend fails both.
test("默认组合根走真实 IndexedDB 后端:生词状态跨重启读回", async () => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes("dictionary.json")) {
        return {
          ok: true,
          json: async () => ({
            ipa: { woke: "woʊk" },
            inflections: {},
            entries: { woke: { p: "wəʊk", t: "v. 醒来" } },
          }),
        } as unknown as Response;
      }
      throw new Error(`unexpected fetch: ${url}`);
    })
  );
  const book = await buildEpub({
    title: "Root Book",
    docs: [
      { href: "text/r.xhtml", body: "<h1>R</h1><p>Woke on the page.</p>" },
    ],
  });
  // Seeded through the real composition pieces before the mount: the
  // face may only show its state once the page's own store has resolved.
  const seedStore = createVocabularyStore(
    new OfflineDictionary({ ipa: {}, inflections: {}, entries: {} }),
    createStorageBackend(createIdbNamespaceStorage())
  );
  await seedStore.setStatus("woke", "known");

  const tree = () => <App />;
  const pickBook = async () => {
    const input = document.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;
    Object.defineProperty(input, "files", {
      value: [new File([book as BlobPart], "book.epub")],
      configurable: true,
    });
    fireEvent.change(input);
    await screen.findByText("Woke");
  };
  const openPopup = async () => {
    fireEvent.click(document.querySelector("[data-word='Woke']")!);
    return screen.findByRole("dialog", { name: "词详情：Woke" });
  };

  render(tree());
  await pickBook();
  const dialog = await openPopup();
  // The seeded fact reads back through the page's own root: 已掌握.
  // (The popup mounts in its loading phase — the async lookup through
  // the real backend lands a beat after the dialog appears; awaiting
  // the status group is both the found-phase gate and the gateway signal.)
  const group = await within(dialog).findByRole("group", {
    name: "生词本状态",
  });
  expect(within(group).getByRole("button", { name: "已掌握" })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  fireEvent.click(within(group).getByRole("button", { name: "学习中" }));
  await waitFor(() =>
    expect(
      within(group).getByRole("button", { name: "学习中" })
    ).toHaveAttribute("aria-pressed", "true")
  );

  // The mount dies; a fresh one reads the same database.
  cleanup();
  render(tree());
  await pickBook();
  const again = await openPopup();
  const regroup = await within(again).findByRole("group", {
    name: "生词本状态",
  });
  expect(
    within(regroup).getByRole("button", { name: "学习中" })
  ).toHaveAttribute("aria-pressed", "true");
  expect(
    within(regroup).getByRole("button", { name: "已掌握" })
  ).toHaveAttribute("aria-pressed", "false");
});
