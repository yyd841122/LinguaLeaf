import type { ImportErrorCode, ImportStage } from "../../server/src/wire";

// The shelf's reader-facing vocabulary for the import lifecycle: label and
// copy maps keyed by the wire's machine fields. The unions come from the
// server's contract module (apps/server/src/wire.ts, type-only import), and
// the Record types make a stage or code without copy a compile error here —
// the drift guard the old string-keyed map and the 文案 comparison could
// never give. Display prose stays web-owned: the server may reword its
// error bodies freely.

export const IMPORT_STAGE_LABELS: Record<ImportStage, string> = {
  annotating: "标注生成中",
  translating: "翻译译文",
  saving: "保存书籍",
};

// An importing row's stage label; the percent rides on the label with a
// space ('translating' is the only stage that carries one).
export function importStageLabel(
  stage: ImportStage | null,
  percent: number | null
): string {
  const label =
    stage === null
      ? ""
      : stage in IMPORT_STAGE_LABELS
        ? IMPORT_STAGE_LABELS[stage]
        : // Unreachable per the shared union; the books.import_stage TEXT
          // column cannot rule it out. Pinned, not endorsed — the
          // unknown-stage test in bookshelf.test.tsx owns this flip.
          "处理中";
  return percent === null ? label : `${label} ${percent}%`;
}

export const IMPORT_ERROR_COPY: Record<ImportErrorCode, string> = {
  "unsupported-format":
    "导入失败：只接受 .epub、.md、.markdown 或 .pdf 文件（≤20MB）。",
  "file-too-large": "导入失败：文件超过 20MB 上限。",
  "scanned-pdf": "导入失败：扫描件/图片型 PDF 暂不支持。",
  "encrypted-pdf": "导入失败：加密 PDF 暂不支持。",
  "invalid-epub": "导入失败：文件无法解析，可能已损坏。",
  "invalid-pdf": "导入失败：文件无法解析，可能已损坏。",
};

// The shelf copy for one upload rejection code; null for a code the shared
// vocabulary does not know — the caller falls back to the retry copy.
export function importErrorCopy(code: string): string | null {
  return code in IMPORT_ERROR_COPY
    ? IMPORT_ERROR_COPY[code as ImportErrorCode]
    : null;
}
