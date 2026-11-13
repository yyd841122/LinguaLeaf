// The TS half of the SaveToDownloads native plugin (backup 保存到本机):
// a typed wrapper so the file adapter stays TypeScript end to end. The
// native side inserts the JSON into the shared Downloads collection —
// no storage permission on Android 10+ (scoped storage), the file shows
// up in 文件管理's Downloads where the import picker starts.
import { registerPlugin } from "@capacitor/core";

export interface SaveToDownloadsPlugin {
  save(options: { data: string; name: string }): Promise<{ uri: string }>;
}

export const SaveToDownloads =
  registerPlugin<SaveToDownloadsPlugin>("SaveToDownloads");
