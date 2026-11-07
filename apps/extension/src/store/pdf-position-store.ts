import {
  createNamespaceRecord,
  type NamespaceStorage,
} from "./namespace-record";

export type PdfPosition = { docId: string; page: number; scale: number };
export type PdfRecent = PdfPosition & { title: string };
export interface PdfPositionStore {
  getPosition(docId: string): Promise<PdfPosition | null>;
  getRecent(): Promise<PdfRecent | null>;
  getSnapshot(): Promise<{
    positions: PdfPosition[];
    recent: PdfRecent | null;
  }>;
  clearRecentIf(docId: string): Promise<void>;
  setPosition(position: PdfRecent): Promise<void>;
}
type PositionRecord = {
  version: 1;
  positions: PdfPosition[];
  recent: PdfRecent | null;
};
const empty = (): PositionRecord => ({
  version: 1,
  positions: [],
  recent: null,
});
function validPosition(value: unknown): value is PdfPosition {
  return (
    typeof value === "object" &&
    value !== null &&
    "docId" in value &&
    typeof value.docId === "string" &&
    "page" in value &&
    typeof value.page === "number" &&
    Number.isInteger(value.page) &&
    value.page >= 1 &&
    "scale" in value &&
    typeof value.scale === "number" &&
    [0.75, 1, 1.5].includes(value.scale)
  );
}
function validRecent(value: unknown): value is PdfRecent {
  return (
    validPosition(value) && "title" in value && typeof value.title === "string"
  );
}
function decode(raw: unknown): PositionRecord {
  if (
    typeof raw !== "object" ||
    raw === null ||
    !("version" in raw) ||
    raw.version !== 1 ||
    !("positions" in raw) ||
    !Array.isArray(raw.positions) ||
    !raw.positions.every(validPosition) ||
    !("recent" in raw) ||
    (raw.recent !== null && !validRecent(raw.recent))
  )
    throw new Error("PDF 阅读位置存储损坏");
  return {
    version: 1,
    positions: raw.positions,
    recent:
      raw.recent === null
        ? null
        : {
            docId: raw.recent.docId,
            page: raw.recent.page,
            scale: raw.recent.scale,
            title: raw.recent.title,
          },
  };
}

// Convenience data never prevents reading. Notes have a separate namespace
// and deliberately do NOT use this missing-on-failure policy.
export function createPdfPositionStore(
  storage?: NamespaceStorage
): PdfPositionStore {
  const record = createNamespaceRecord<unknown>(
    "pdf-positions",
    empty,
    storage
  );
  let pendingWrite: Promise<void> = Promise.resolve();
  return {
    async getPosition(docId) {
      await pendingWrite;
      try {
        return (
          decode(await record.read()).positions.find(
            (entry) => entry.docId === docId
          ) ?? null
        );
      } catch {
        return null;
      }
    },
    async getRecent() {
      await pendingWrite;
      try {
        return decode(await record.read()).recent;
      } catch {
        return null;
      }
    },
    async getSnapshot() {
      await pendingWrite;
      try {
        const { positions, recent } = decode(await record.read());
        return { positions, recent };
      } catch {
        return { positions: [], recent: null };
      }
    },
    clearRecentIf(docId) {
      const run = record.update(async (raw, write) => {
        const data = decode(raw);
        if (data.recent?.docId !== docId) return;
        data.recent = null;
        await write(data);
      });
      // Unlike best-effort position saves, cleanup failures must be visible
      // to the shelf so they can be retried without deleting any positions.
      pendingWrite = run.catch(() => undefined);
      return run;
    },
    setPosition(position) {
      pendingWrite = record
        .update(async (raw, write) => {
          const data = decode(raw);
          data.positions = data.positions.filter(
            (entry) => entry.docId !== position.docId
          );
          const { docId, page, scale } = position;
          data.positions.push({ docId, page, scale });
          data.recent = position;
          await write(data);
        })
        .catch(() => {
          /* Convenience data never interrupts notes or drafts. */
        });
      return pendingWrite;
    },
  };
}
export function createMemoryPdfPositionStore(): PdfPositionStore {
  const bag: Record<string, unknown> = {};
  return createPdfPositionStore({
    async get() {
      return structuredClone(bag);
    },
    async set(next) {
      Object.assign(bag, structuredClone(next));
    },
  });
}
