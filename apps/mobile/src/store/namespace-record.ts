// One namespace record in the injected storage backend (mobile hosts it
// on IndexedDB — createIdbNamespaceStorage; the extension's copy keeps its
// chrome.storage.local default, this mobile copy requires the backend
// explicitly so the app holds zero chrome references): read with default,
// and a serialized read-modify-write. Every write runs on one promise
// chain — the chain is the mutex; nothing else may write. The reader page
// is single-view (the app has one activity), but two async writes of the
// SAME page still interleave: popup saves for two words overlap freely,
// and a debounced progress save can overlap a document open — a stale
// read-modify-write would drop the earlier one (extension-reader ticket
// 07; ext-reuse-convergence made the queue the one write path for every
// backend).
export type NamespaceStorage = {
  get(namespace: string): Promise<Record<string, unknown>>;
  set(bag: Record<string, unknown>): Promise<void>;
};

export function createNamespaceRecord<T>(
  namespace: string,
  empty: () => T,
  storage: NamespaceStorage
): {
  read(): Promise<T>;
  update<U>(
    step: (record: T, write: (record: T) => Promise<void>) => Promise<U>
  ): Promise<U>;
} {
  const read = async (): Promise<T> => {
    const bag = await storage.get(namespace);
    return (bag[namespace] as T | undefined) ?? empty();
  };
  const write = (record: T): Promise<void> =>
    storage.set({ [namespace]: record });
  let writeQueue: Promise<unknown> = Promise.resolve();
  // One serialized read-modify-write step: the step reads fresh inside the
  // chain and persists through write.
  const update = <U>(
    step: (record: T, write: (record: T) => Promise<void>) => Promise<U>
  ): Promise<U> => {
    const run = writeQueue.then(async () => step(await read(), write));
    writeQueue = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  };
  return { read, update };
}
