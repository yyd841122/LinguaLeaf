// The backup file adapter (mobile-app ticket 05): the seam between the
// pure payload and the phone's 存文件/系统分享. The Capacitor twin writes
// the JSON into the cache directory and hands it to the system share
// sheet (存到文件 / Drive / 微信 — the reader picks the destination); the
// memory twin is what tests drive (jsdom never loads a native bridge).

import { Filesystem, Directory, Encoding } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import {
  BACKUP_APP,
  BACKUP_VERSION,
  type BackupPayload,
} from "./backup-format";

export interface BackupFileAdapter {
  // Serialize + persist + hand off. Resolves when the share sheet has
  // been shown (the sheet itself is the user's next action, not ours).
  save(payload: BackupPayload): Promise<void>;
}

const pad = (value: number) => String(value).padStart(2, "0");

export function backupFileName(now: () => number = Date.now): string {
  const t = new Date(now());
  return `${BACKUP_APP}-v${BACKUP_VERSION}-${t.getFullYear()}${pad(
    t.getMonth() + 1
  )}${pad(t.getDate())}-${pad(t.getHours())}${pad(t.getMinutes())}.json`;
}

export function createCapacitorBackupFileAdapter(): BackupFileAdapter {
  return {
    async save(payload) {
      const path = backupFileName();
      const result = await Filesystem.writeFile({
        path,
        data: JSON.stringify(payload),
        directory: Directory.Cache,
        encoding: Encoding.UTF8,
      });
      await Share.share({
        title: path,
        url: result.uri,
        dialogTitle: "导出备份",
      });
    },
  };
}

export function createMemoryBackupFileAdapter(): BackupFileAdapter & {
  saved: { path: string; payload: BackupPayload }[];
} {
  const saved: { path: string; payload: BackupPayload }[] = [];
  return {
    saved,
    async save(payload) {
      saved.push({ path: backupFileName(), payload });
    },
  };
}
