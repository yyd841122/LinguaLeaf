import {
  createNamespaceRecord,
  type NamespaceStorage,
} from "./namespace-record";

// The reader's face-level preferences (mobile-app ticket 03, round 14):
// where the PDF toolbar sits — pinned under the title or below the page
// number. A global choice, not a per-book fact. Read failures degrade to
// the default (convenience settings never block reading — the
// pdf-position store's same policy).

export type PdfToolbarPosition = "top" | "bottom";
export type UiSettings = { pdfToolbar: PdfToolbarPosition };

export interface UiSettingsStore {
  load(): Promise<UiSettings>;
  savePdfToolbar(position: PdfToolbarPosition): Promise<void>;
}

type StoredRecord = { version: 1; pdfToolbar: PdfToolbarPosition };
const empty = (): StoredRecord => ({ version: 1, pdfToolbar: "top" });

function decode(raw: unknown): StoredRecord {
  if (
    typeof raw !== "object" ||
    raw === null ||
    !("version" in raw) ||
    (raw as { version?: unknown }).version !== 1
  )
    return empty();
  const pdfToolbar = (raw as { pdfToolbar?: unknown }).pdfToolbar;
  return {
    version: 1,
    pdfToolbar: pdfToolbar === "bottom" ? "bottom" : "top",
  };
}

export function createUiSettingsStore(
  storage: NamespaceStorage
): UiSettingsStore {
  const record = createNamespaceRecord<unknown>("ui-settings", empty, storage);
  return {
    async load() {
      try {
        return { pdfToolbar: decode(await record.read()).pdfToolbar };
      } catch {
        return empty();
      }
    },
    savePdfToolbar(position) {
      return record
        .update(async (raw, write) => {
          const data = decode(raw);
          data.pdfToolbar = position;
          await write(data);
        })
        .catch(() => undefined);
    },
  };
}

export function createMemoryUiSettingsStore(): UiSettingsStore {
  let settings: StoredRecord = empty();
  return {
    async load() {
      return { pdfToolbar: decode(structuredClone(settings)).pdfToolbar };
    },
    async savePdfToolbar(position) {
      settings = { version: 1, pdfToolbar: position };
    },
  };
}
