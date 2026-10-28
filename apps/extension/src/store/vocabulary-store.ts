import type {
  OfflineDictionary,
  OfflineLookup,
} from "../dict/offline-dictionary";

// ADR-0005's four states, the three stored ones — 'New' is a record's
// absence, never a stored value (the first lookup migrates it).
export type VocabState = "learning" | "known" | "ignored";

// What the popup renders for one lookup: the dictionary entry plus the
// state the lookup itself settled (查词即状态 — a found word always
// carries a concrete state).
export type LookupWithState = OfflineLookup & { status: VocabState };

// Where committed states live. Two shapes exist: an in-memory map (tests)
// and chrome.storage.local (the real one). Everything above this seam —
// the 查词即状态 flow, the popup's operations — is shared code below, so
// the whole behavior surface is tested against the memory backend and the
// chrome one stays thin (types + serialized atomic reads/writes).
export interface StateBackend {
  get(key: string): Promise<VocabState | null>;
  getMany(keys: string[]): Promise<Map<string, VocabState>>;
  put(key: string, status: VocabState): Promise<void>;
  // 查词即状态's write: set Learning only when the key has no state, and
  // return the settled state. Atomic with respect to every other write —
  // a delayed lookup can never overwrite an explicit status that landed
  // while the lookup was reading.
  enroll(key: string): Promise<VocabState>;
}

// The extension's one new storage seam (spec): the 生词本 semantics the
// page and popup program against. The reading page never touches
// chrome.* — it holds one of these.
export interface VocabularyStore {
  // Folds a word to its state key (lemma when known, else the folded
  // form) — the one key rule for popup writes and reading-walk tints.
  stateKey(word: string): string;
  // 查词即状态: a dictionary miss writes nothing and answers null; an
  // unrecorded lemma enters Learning inside this same call; a recorded
  // state stands and is never overwritten by a lookup.
  lookup(word: string): Promise<LookupWithState | null>;
  // The popup's explicit set — idempotent, any state from any other.
  setStatus(key: string, status: VocabState): Promise<void>;
  // Bulk read for the reading walk's tints; absent keys are New.
  statesFor(keys: string[]): Promise<Map<string, VocabState>>;
}

async function lookupFlow(
  dictionary: OfflineDictionary,
  backend: StateBackend,
  rawWord: string
): Promise<LookupWithState | null> {
  const entry = dictionary.lookup(rawWord);
  if (!entry) return null;
  const key = dictionary.stateKey(rawWord);
  const status = await backend.enroll(key);
  return { ...entry, status };
}

export function createVocabularyStore(
  dictionary: OfflineDictionary,
  backend: StateBackend
): VocabularyStore {
  return {
    stateKey: (word) => dictionary.stateKey(word),
    lookup: (word) => lookupFlow(dictionary, backend, word),
    setStatus: (key, status) => backend.put(key, status),
    statesFor: (keys) => backend.getMany(keys),
  };
}

// The tests' backend (and any future non-chrome host): a plain map the
// test can seed and inspect.
export function memoryBackend(): StateBackend & {
  map: Map<string, VocabState>;
} {
  const map = new Map<string, VocabState>();
  return {
    map,
    async get(key) {
      return map.get(key) ?? null;
    },
    async getMany(keys) {
      const found = new Map<string, VocabState>();
      for (const key of keys) {
        const state = map.get(key);
        if (state) found.set(key, state);
      }
      return found;
    },
    async put(key, status) {
      map.set(key, status);
    },
    async enroll(key) {
      // Synchronous map: read and set are one step, the serialize-by-
      // construction twin of the chrome backend's write queue.
      const existing = map.get(key) ?? null;
      if (existing) return existing;
      map.set(key, "learning");
      return "learning";
    },
  };
}

// The real backend: one namespace record in chrome.storage.local. The
// reader page is single-tab (the service worker focuses the existing
// one), but two async writes of the SAME page can still interleave
// (popup saves for two words overlap freely), and chrome.storage is
// read-modify-write over a whole record — so every write runs on one
// promise chain. The chain is the mutex; nothing else may write.
const STORAGE_NAMESPACE = "vocabulary";

export function chromeBackend(): StateBackend {
  const readAll = async (): Promise<Record<string, VocabState>> => {
    const bag = await chrome.storage.local.get(STORAGE_NAMESPACE);
    return (bag[STORAGE_NAMESPACE] as Record<string, VocabState>) ?? {};
  };
  let writeQueue = Promise.resolve();
  // One serialized read-modify-write step.
  const enqueue = <T>(step: () => Promise<T>): Promise<T> => {
    const run = writeQueue.then(step);
    writeQueue = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  };
  return {
    async get(key) {
      return (await readAll())[key] ?? null;
    },
    async getMany(keys) {
      const all = await readAll();
      const found = new Map<string, VocabState>();
      for (const key of keys) {
        if (all[key]) found.set(key, all[key]);
      }
      return found;
    },
    put(key, status) {
      return enqueue(async () => {
        const all = await readAll();
        all[key] = status;
        await chrome.storage.local.set({ [STORAGE_NAMESPACE]: all });
      });
    },
    enroll(key) {
      return enqueue(async () => {
        const all = await readAll();
        const existing = all[key] ?? null;
        if (existing) return existing;
        all[key] = "learning";
        await chrome.storage.local.set({ [STORAGE_NAMESPACE]: all });
        return "learning";
      });
    },
  };
}
