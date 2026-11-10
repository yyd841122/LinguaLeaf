import {
  createNamespaceRecord,
  type NamespaceStorage,
} from "./namespace-record";

// The runtime home of the DeepSeek connection settings (mobile-app ticket
// 04, ADR-0008): the key, base URL and model are filled in on the settings
// page at runtime and stored in the app's local data — never compiled into
// the APK. Plain namespace record over IndexedDB (ticket 02's 纯 IDB
// sequencing: zero native plugins); the key sits beside the books and
// notes it serves, on the same device, in the same app-private storage.
// The base URL is the OpenAI-compatible ROOT (the adapter appends
// /chat/completions) — the settings page carries the /anthropic warning.

export type TranslateSettings = {
  apiKey: string;
  baseUrl: string;
  model: string;
};

export const DEFAULT_TRANSLATE_SETTINGS: TranslateSettings = {
  apiKey: "",
  // OpenAI-compatible root, not a page URL and not an /anthropic endpoint.
  baseUrl: "https://api.deepseek.com",
  // The served workhorse name since deepseek-chat's 2026-07-24 retirement
  // (the server adapter's same default).
  model: "deepseek-flash",
};

// True when a translation trigger has a key to present. Only the key
// gates: an odd base URL or model fails at request time into the same
// readable failure flag as a network outage.
export function isConfigured(settings: TranslateSettings): boolean {
  return settings.apiKey.trim().length > 0;
}

export interface TranslateSettingsStore {
  load(): Promise<TranslateSettings>;
  save(settings: TranslateSettings): Promise<void>;
}

type StoredRecord = { settings: TranslateSettings | null };
const empty = (): StoredRecord => ({ settings: null });

function sanitize(settings: TranslateSettings): TranslateSettings {
  return {
    apiKey: settings.apiKey.trim(),
    baseUrl: settings.baseUrl.trim(),
    model: settings.model.trim(),
  };
}

// Memory-backed twin for tests (jsdom never opens IndexedDB).
export function createMemoryTranslateSettingsStore(): TranslateSettingsStore {
  let current: TranslateSettings | null = null;
  return {
    async load() {
      return { ...(current ?? DEFAULT_TRANSLATE_SETTINGS) };
    },
    async save(settings) {
      current = sanitize(settings);
    },
  };
}

// The real store: one namespace record through the shared helper over the
// injected backend (IndexedDB on the phone).
const STORAGE_NAMESPACE = "translate-settings";

export function createTranslateSettingsStore(
  storage: NamespaceStorage
): TranslateSettingsStore {
  const record = createNamespaceRecord<StoredRecord>(
    STORAGE_NAMESPACE,
    empty,
    storage
  );
  return {
    async load() {
      const r = await record.read();
      return { ...(r.settings ?? DEFAULT_TRANSLATE_SETTINGS) };
    },
    save(settings) {
      return record.update(async (r, write) => {
        r.settings = sanitize(settings);
        await write(r);
      });
    },
  };
}
