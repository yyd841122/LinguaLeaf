// One namespace record in chrome.storage.local: read with default, and a
// serialized read-modify-write. Every write runs on one promise chain —
// the chain is the mutex; nothing else may write. The reader page is
// single-tab (the service worker focuses the existing one), but two async
// writes of the SAME page still interleave: popup saves for two words
// overlap freely, and a debounced progress save can overlap a document
// open — a stale read-modify-write would drop the earlier one
// (extension-reader ticket 07; ext-reuse-convergence made the queue the
// one write path for every chrome backend).
export function createNamespaceRecord<T>(
  namespace: string,
  empty: () => T
): {
  read(): Promise<T>;
  update<U>(
    step: (record: T, write: (record: T) => Promise<void>) => Promise<U>
  ): Promise<U>;
} {
  const read = async (): Promise<T> => {
    const bag = await chrome.storage.local.get(namespace);
    return (bag[namespace] as T | undefined) ?? empty();
  };
  const write = (record: T): Promise<void> =>
    chrome.storage.local.set({ [namespace]: record });
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
