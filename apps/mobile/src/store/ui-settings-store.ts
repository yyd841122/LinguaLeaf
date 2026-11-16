import {
  createNamespaceRecord,
  type NamespaceStorage,
} from "./namespace-record";

// The reader's global face preferences. Redesign ticket 01: the record
// carries the manual theme choice (暖纸 | 白 | 夜间 | 跟随系统) — the
// default follows the system so ticket 06's dark-follow readers keep
// their dark; the version 1 pdfToolbar item retired with the migration
// (ticket 02 removes its UI). A global choice, not a per-book fact.
// Read failures degrade to the default (convenience settings never
// block reading — the pdf-position store's same policy).

export type ThemePreference = "paper" | "white" | "night" | "system";
export type UiSettings = { theme: ThemePreference };

export interface UiSettingsStore {
  load(): Promise<UiSettings>;
  saveTheme(theme: ThemePreference): Promise<void>;
}

type StoredRecord = { version: 2; theme: ThemePreference };
const empty = (): StoredRecord => ({ version: 2, theme: "system" });

const isThemePreference = (value: unknown): value is ThemePreference =>
  value === "paper" ||
  value === "white" ||
  value === "night" ||
  value === "system";

function decode(raw: unknown): StoredRecord {
  if (
    typeof raw !== "object" ||
    raw === null ||
    !("version" in raw) ||
    (raw as { version?: unknown }).version !== 2
  )
    // Version 1 (pdfToolbar) and anything unrecognized migrate to the
    // default: the toolbar choice retired by design, the theme starts
    // following the system.
    return empty();
  const theme = (raw as { theme?: unknown }).theme;
  return {
    version: 2,
    theme: isThemePreference(theme) ? theme : "system",
  };
}

export function createUiSettingsStore(
  storage: NamespaceStorage
): UiSettingsStore {
  const record = createNamespaceRecord<unknown>("ui-settings", empty, storage);
  return {
    async load() {
      try {
        return { theme: decode(await record.read()).theme };
      } catch {
        return empty();
      }
    },
    saveTheme(theme) {
      return record
        .update(async (raw, write) => {
          const data = decode(raw);
          data.theme = theme;
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
      return { theme: decode(structuredClone(settings)).theme };
    },
    async saveTheme(theme) {
      settings = { version: 2, theme };
    },
  };
}
