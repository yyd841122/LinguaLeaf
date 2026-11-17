import {
  createNamespaceRecord,
  type NamespaceStorage,
} from "./namespace-record";

// 逐书学习开关 (redesign 02): each book remembers its own 音标 / 译文
// preference — a NEW ability (the pre-redesign app had one page-global
// ipa state and an EpubReader-local translation state, neither
// survived a book switch). The defaults ARE the old global values
// (both on), so existing readers see no change until they override.
// One namespace record holds the whole map; 换书 / 冷启 / 返回书架 all
// read through load(docId) per book, writes land immediately.

export type LearningToggles = { ipa: boolean; translation: boolean };
export const DEFAULT_LEARNING: LearningToggles = {
  ipa: true,
  translation: true,
};

export interface LearningSettingsStore {
  load(docId: string): Promise<LearningToggles>;
  save(docId: string, toggles: Partial<LearningToggles>): Promise<void>;
}

type StoredRecord = { version: 1; books: Record<string, LearningToggles> };
const empty = (): StoredRecord => ({ version: 1, books: {} });

const bool = (value: unknown, fallback: boolean): boolean =>
  typeof value === "boolean" ? value : fallback;

const decodeToggles = (raw: unknown): LearningToggles => ({
  ipa: bool((raw as { ipa?: unknown } | undefined)?.ipa, DEFAULT_LEARNING.ipa),
  translation: bool(
    (raw as { translation?: unknown } | undefined)?.translation,
    DEFAULT_LEARNING.translation
  ),
});

function decode(raw: unknown): StoredRecord {
  if (
    typeof raw !== "object" ||
    raw === null ||
    !("version" in raw) ||
    (raw as { version?: unknown }).version !== 1 ||
    typeof (raw as { books?: unknown }).books !== "object" ||
    (raw as { books?: unknown }).books === null
  )
    return empty();
  const books: Record<string, LearningToggles> = {};
  for (const [docId, value] of Object.entries(
    (raw as { books?: Record<string, unknown> }).books ?? {}
  )) {
    if (typeof value === "object" && value !== null)
      books[docId] = decodeToggles(value);
  }
  return { version: 1, books };
}

export function createLearningSettingsStore(
  storage: NamespaceStorage
): LearningSettingsStore {
  const record = createNamespaceRecord<unknown>(
    "learning-settings",
    empty,
    storage
  );
  return {
    async load(docId) {
      try {
        return (
          decode(await record.read()).books[docId] ?? { ...DEFAULT_LEARNING }
        );
      } catch {
        return { ...DEFAULT_LEARNING };
      }
    },
    save(docId, toggles) {
      return record
        .update(async (raw, write) => {
          const data = decode(raw);
          data.books[docId] = {
            ...DEFAULT_LEARNING,
            ...data.books[docId],
            ...toggles,
          };
          await write(data);
        })
        .catch(() => undefined);
    },
  };
}

export function createMemoryLearningSettingsStore(): LearningSettingsStore {
  let record: StoredRecord = empty();
  return {
    async load(docId) {
      return (
        decode(structuredClone(record)).books[docId] ?? { ...DEFAULT_LEARNING }
      );
    },
    async save(docId, toggles) {
      record = {
        version: 1,
        books: {
          ...record.books,
          [docId]: { ...DEFAULT_LEARNING, ...record.books[docId], ...toggles },
        },
      };
    },
  };
}
