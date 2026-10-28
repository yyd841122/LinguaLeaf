import {
  isEpubFilename,
  readEpubBook,
  splitSentences,
  UploadRejected,
  type ImportErrorCode,
  type PreparedBook,
} from "@lingualeaf/import-core";

// The extension's block shapes: the same sentence-split walk as the
// server's annotation pass (buildChapterBlocks), minus IPA — the offline
// dictionary (ticket 03) fills the slots this type will grow. Image and
// passthrough blocks stay unannotated placeholders, mirroring the server.
export type ExtSentenceBlock = { kind: "sentence"; text: string };
export type ExtPlainBlock = { kind: "code" | "raw" | "image"; text: string };
export type ExtBlock = ExtSentenceBlock | ExtPlainBlock;
export type ExtChapter = {
  title: string;
  level: number | null;
  blocks: ExtBlock[];
};
export type ExtBook = { title: string; chapters: ExtChapter[] };

// Reader-facing copy per rejection reason, extension-owned prose keyed by
// the shared codes (CODING_STANDARDS: error bodies are a code plus copy).
// Record-typed so a wire member without copy is a compile error. The
// upload cap and HTTP statuses are server facts — the extension reads the
// user's own file, so its copy differs where the reasons are server-shaped.
export const IMPORT_ERROR_COPY: Record<ImportErrorCode, string> = {
  "unsupported-format": "暂不支持这种文件——扩展阅读页当前支持 EPUB。",
  "invalid-epub": "导入失败：文件无法解析，可能已损坏。",
  "invalid-pdf": "暂不支持 PDF——扩展阅读页当前支持 EPUB。",
  "encrypted-pdf": "暂不支持加密 PDF——扩展阅读页当前支持 EPUB。",
  "scanned-pdf": "扫描版 PDF 不支持——《书》只收文本层完好的文档。",
  "file-too-large": "导入失败：文件过大。",
};

// FileReader, not File.arrayBuffer(): the read shape every jsdom version
// implements, so the page's tests drive real File objects without
// shimming the platform.
function readAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsArrayBuffer(file);
  });
}

// One import entry for the page: a File in, ExtBook out; rejections carry
// their wire reason so the page can show the matching copy.
export async function importBookFromFile(file: File): Promise<ExtBook> {
  return importBook(await readAsArrayBuffer(file), file.name);
}

// Bytes in, ExtBook out — the direct form the tests use beside the File
// entry point.
export async function importBook(
  content: ArrayBuffer,
  filename: string
): Promise<ExtBook> {
  if (!isEpubFilename(filename)) {
    throw new UploadRejected(
      "unsupported-format",
      "the extension reader accepts EPUB files"
    );
  }
  return assembleBook(await readEpubBook(content, filename));
}

// The extension's block assembly over the extracted chapters: sentence
// blocks per split sentence, images as placeholders, code/passthrough
// verbatim. The server's buildChapterBlocks walks the identical shapes —
// and the 03 IPA seam sits exactly at the split, where each sentence block
// will also carry its slot array.
function assembleBook(prepared: PreparedBook): ExtBook {
  return {
    title: prepared.title,
    chapters: prepared.chapters.map((chapter) => ({
      title: chapter.title,
      level: chapter.level,
      blocks: chapter.items.flatMap((item): ExtBlock[] =>
        item.kind === "paragraph"
          ? splitSentences(item.text).map((text) => ({
              kind: "sentence",
              text,
            }))
          : [{ kind: item.kind, text: item.text }]
      ),
    })),
  };
}
