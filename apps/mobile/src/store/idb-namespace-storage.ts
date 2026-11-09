import type { NamespaceStorage } from "./namespace-record";

// The WebView replacement for chrome.storage.local's namespace use
// (mobile-app ticket 02, in-ticket decision: 纯 IDB, no native plugin).
// One IndexedDB database, one out-of-line key per namespace record
// ("library" / "vocabulary" / "notes" / "pdf-notes"). The open/transaction
// discipline mirrors createIndexedDbBytesBackend — the pattern the
// extension's smoke proved against native IndexedDB — so per-operation
// connections close behind their transaction and version upgrades never
// block a live handle.
export const READER_RECORDS_DATABASE = "lingualeaf-reader";
const NAMESPACES = "namespaces";

export function createIdbNamespaceStorage(
  factory?: IDBFactory,
  database = READER_RECORDS_DATABASE
): NamespaceStorage {
  const open = () =>
    new Promise<IDBDatabase>((resolve, reject) => {
      const request = (factory ?? indexedDB).open(database, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore(NAMESPACES);
      };
      request.onerror = () =>
        reject(request.error ?? new Error("阅读记录库无法打开"));
      request.onblocked = () =>
        reject(new Error("阅读记录库升级受阻，请关闭其他阅读页后重试"));
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => db.close();
        resolve(db);
      };
    });
  // All requests queue synchronously inside the live transaction; the
  // handle closes when the transaction settles.
  async function transaction<T>(
    mode: IDBTransactionMode,
    step: (namespaces: IDBObjectStore, result: (value: T) => void) => void
  ): Promise<T> {
    const db = await open();
    return new Promise<T>((resolve, reject) => {
      let value: T;
      let tx: IDBTransaction;
      try {
        tx = db.transaction([NAMESPACES], mode);
      } catch (error) {
        db.close();
        reject(error);
        return;
      }
      tx.oncomplete = () => {
        db.close();
        resolve(value);
      };
      tx.onabort = tx.onerror = () => {
        db.close();
        reject(tx.error ?? new Error("阅读记录事务失败"));
      };
      try {
        step(tx.objectStore(NAMESPACES), (next) => {
          value = next;
        });
      } catch (error) {
        tx.abort();
        db.close();
        reject(error);
      }
    });
  }
  return {
    // chrome.storage.local.get parity: a missing namespace is absent from
    // the bag, not null — the namespace record reads it as empty().
    get: (namespace) =>
      transaction<Record<string, unknown>>("readonly", (store, result) => {
        const request = store.get(namespace);
        request.onsuccess = () =>
          result(
            request.result === undefined ? {} : { [namespace]: request.result }
          );
      }),
    set: (bag) =>
      transaction<void>("readwrite", (store) => {
        for (const [namespace, record] of Object.entries(bag)) {
          store.put(record, namespace);
        }
      }),
  };
}
