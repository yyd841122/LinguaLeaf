import { render, screen, waitFor } from "@testing-library/react";
import { expect, test } from "vitest";
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
  expect(screen.getByLabelText("选择 EPUB 或 PDF 文件")).toBeInTheDocument();
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
