import { pdfFingerprint, PDF_DOC_ID_PREFIX } from "./pdf-fingerprint";

export type PdfBytesMetadata = {
  docId: string;
  title: string;
  size: number;
  storedAt: number;
};
export type PdfBytesRecord = PdfBytesMetadata & { blob: Blob };

// A backend mutation resolves only after atomic commit. Failed replacements
// leave the previous metadata AND bytes intact. The memory seam tests callers;
// smoke.mjs separately proves this contract against native IndexedDB.
export interface PdfBytesBackend {
  list(): Promise<unknown[]>;
  get(docId: string): Promise<unknown>;
  put(record: PdfBytesRecord): Promise<void>;
  delete(docId: string): Promise<void>;
}
export interface PdfBytesStore {
  list(): Promise<PdfBytesMetadata[]>;
  get(docId: string): Promise<PdfBytesRecord>;
  save(input: { docId: string; title: string; blob: Blob }): Promise<void>;
  delete(docId: string): Promise<void>;
}

export function readPdfBlob(blob: Blob): Promise<ArrayBuffer> {
  // Native Blob keeps ownership while PDF.js receives a disposable buffer.
  // FileReader is also available in older browsers and the jsdom test seam.
  if (typeof blob.arrayBuffer === "function") return blob.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () =>
      reject(reader.error ?? new Error("PDF 字节读取失败"));
    reader.onabort = () => reject(new Error("PDF 字节读取已取消"));
    reader.readAsArrayBuffer(blob);
  });
}
function metadata(raw: unknown): PdfBytesMetadata {
  if (
    typeof raw !== "object" ||
    raw === null ||
    !("docId" in raw) ||
    typeof raw.docId !== "string" ||
    !new RegExp(`^${PDF_DOC_ID_PREFIX}[a-f0-9]{64}$`).test(raw.docId) ||
    !("title" in raw) ||
    typeof raw.title !== "string" ||
    !("size" in raw) ||
    typeof raw.size !== "number" ||
    !Number.isSafeInteger(raw.size) ||
    raw.size <= 0 ||
    !("storedAt" in raw) ||
    typeof raw.storedAt !== "number" ||
    !Number.isFinite(raw.storedAt) ||
    raw.storedAt < 0
  )
    throw new Error("PDF 书架记录损坏");
  return {
    docId: raw.docId,
    title: raw.title,
    size: raw.size,
    storedAt: raw.storedAt,
  };
}

export function createPdfBytesStore(
  backend: PdfBytesBackend = createIndexedDbBytesBackend(),
  now: () => number = Date.now
): PdfBytesStore {
  const pending = new Map<string, Promise<void>>();
  const mutate = (docId: string, operation: () => Promise<void>) => {
    const run = (pending.get(docId) ?? Promise.resolve()).then(operation);
    const settled = run.then(
      () => undefined,
      () => undefined
    );
    pending.set(docId, settled);
    void settled.then(() => {
      if (pending.get(docId) === settled) pending.delete(docId);
    });
    return run;
  };
  return {
    async list() {
      // No Blob reads, including when a save is still preparing its digest.
      const entries = (await backend.list()).map(metadata);
      if (new Set(entries.map((entry) => entry.docId)).size !== entries.length)
        throw new Error("PDF 书架记录重复");
      return entries.sort((a, b) => b.storedAt - a.storedAt);
    },
    async get(docId) {
      await pending.get(docId);
      const raw = await backend.get(docId);
      const entry = metadata(raw);
      if (
        entry.docId !== docId ||
        typeof raw !== "object" ||
        raw === null ||
        !("blob" in raw) ||
        !(raw.blob instanceof Blob) ||
        raw.blob.size !== entry.size
      )
        throw new Error("PDF 原书字节缺失或损坏");
      return { ...entry, blob: raw.blob };
    },
    save({ docId, title, blob }) {
      // Enqueue BEFORE async preparation: a later delete must always win.
      return mutate(docId, async () => {
        const bytes = await readPdfBlob(blob);
        if (
          bytes.byteLength !== blob.size ||
          (await pdfFingerprint(bytes)) !== docId
        )
          throw new Error("PDF 原书字节校验失败");
        const entry = metadata({
          docId,
          title,
          size: blob.size,
          storedAt: now(),
        });
        await backend.put({ ...entry, blob });
      });
    },
    delete(docId) {
      return mutate(docId, () => backend.delete(docId));
    },
  };
}

export const PDF_BYTES_DATABASE = "lingualeaf-pdf-bytes";
const VERSION = 1;
const METADATA = "metadata";
const BYTES = "bytes";
export function createIndexedDbBytesBackend(
  factory?: IDBFactory,
  database = PDF_BYTES_DATABASE
): PdfBytesBackend {
  const open = () =>
    new Promise<IDBDatabase>((resolve, reject) => {
      const request = (factory ?? indexedDB).open(database, VERSION);
      let abandoned = false;
      request.onupgradeneeded = () => {
        const db = request.result;
        db.createObjectStore(METADATA, { keyPath: "docId" });
        db.createObjectStore(BYTES);
      };
      request.onerror = () =>
        reject(request.error ?? new Error("PDF 书架无法打开"));
      request.onblocked = () => {
        abandoned = true;
        reject(new Error("PDF 书架升级受阻，请关闭其他阅读页后重试"));
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => db.close();
        if (abandoned) db.close();
        else resolve(db);
      };
    });
  async function transaction<T>(
    mode: IDBTransactionMode,
    step: (tx: IDBTransaction, result: (value: T) => void) => void
  ): Promise<T> {
    const db = await open();
    return new Promise<T>((resolve, reject) => {
      let value: T;
      let tx: IDBTransaction;
      try {
        tx = db.transaction([METADATA, BYTES], mode);
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
        reject(tx.error ?? new Error("PDF 书架事务失败"));
      };
      try {
        // All requests are queued synchronously; no await inside a live tx.
        step(tx, (next) => {
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
    list: () =>
      transaction<unknown[]>("readonly", (tx, result) => {
        const request = tx.objectStore(METADATA).getAll();
        request.onsuccess = () => result(request.result);
      }),
    get: (docId) =>
      transaction<unknown>("readonly", (tx, result) => {
        const meta = tx.objectStore(METADATA).get(docId);
        const bytes = tx.objectStore(BYTES).get(docId);
        bytes.onsuccess = () => result({ ...meta.result, blob: bytes.result });
      }),
    put: (record) =>
      transaction<void>("readwrite", (tx) => {
        const { blob, ...entry } = record;
        tx.objectStore(METADATA).put(entry);
        tx.objectStore(BYTES).put(blob, record.docId);
      }),
    delete: (docId) =>
      transaction<void>("readwrite", (tx) => {
        tx.objectStore(METADATA).delete(docId);
        tx.objectStore(BYTES).delete(docId);
      }),
  };
}

export function createMemoryPdfBytesBackend(): PdfBytesBackend {
  const records = new Map<string, PdfBytesRecord>();
  return {
    async list() {
      return [...records.values()].map(({ docId, title, size, storedAt }) => ({
        docId,
        title,
        size,
        storedAt,
      }));
    },
    async get(docId) {
      return records.get(docId);
    },
    async put(record) {
      records.set(record.docId, { ...record });
    },
    async delete(docId) {
      records.delete(docId);
    },
  };
}
