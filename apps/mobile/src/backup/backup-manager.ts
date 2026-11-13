// The backup manager (mobile-app ticket 05): the two face-level actions —
// export builds the payload and hands it to the file adapter; import
// parses a picked file, validates the WHOLE payload, and only then writes.
// Failure copy lives here so every rejection reads as a named condition,
// never a stack trace.

import {
  isBackupFormatError,
  validateBackupPayload,
  type ImportSummary,
} from "./backup-format";
import { applyBackup, buildBackup, type BackupStores } from "./backup";
import type { BackupFileAdapter } from "./backup-file";

export interface BackupManager {
  exportBackup(): Promise<void>;
  importBackup(file: File): Promise<ImportSummary>;
}

// FileReader, not File.text(): the read shape every jsdom version
// supports (import-book.ts's same discipline — the test File objects and
// the WebView's File both carry it).
function readAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("读取文件失败。"));
    reader.readAsText(file);
  });
}

export function createBackupManager(
  stores: BackupStores,
  adapter: BackupFileAdapter
): BackupManager {
  return {
    async exportBackup() {
      await adapter.save(await buildBackup(stores));
    },
    async importBackup(file) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(await readAsText(file));
      } catch {
        throw new Error("不是 LinguaLeaf 备份文件：内容不是 JSON。");
      }
      try {
        return await applyBackup(validateBackupPayload(parsed), stores);
      } catch (error) {
        if (isBackupFormatError(error)) throw error;
        throw new Error("导入失败：备份内容无法写入，请重试。");
      }
    },
  };
}
