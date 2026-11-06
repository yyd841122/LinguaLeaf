import { NOTE_TEXT_LIMIT, NOTES_PER_BOOK_LIMIT } from "./notes-store";
import { PDF_DOC_ID_PREFIX } from "./pdf-fingerprint";
import {
  createNamespaceRecord,
  type NamespaceStorage,
} from "./namespace-record";

// PDF pages are one-based; eligible TextItems count from zero on each page.
export type PdfNoteAnchor = {
  docId: string;
  page: number;
  lineIndex: number;
};
export type PdfNote = PdfNoteAnchor & { lineText: string; text: string };
export interface PdfNotesStore {
  list(docId: string): Promise<PdfNote[]>;
  save(
    anchor: PdfNoteAnchor & { lineText: string },
    text: string
  ): Promise<PdfNote>;
  delete(anchor: PdfNoteAnchor): Promise<void>;
}

type NotesRecord = { version: 1; notes: PdfNote[] };
const empty = (): NotesRecord => ({ version: 1, notes: [] });

function validAnchor(value: PdfNoteAnchor): boolean {
  return (
    typeof value.docId === "string" &&
    new RegExp(`^${PDF_DOC_ID_PREFIX}[a-f0-9]{64}$`).test(value.docId) &&
    Number.isInteger(value.page) &&
    value.page >= 1 &&
    Number.isInteger(value.lineIndex) &&
    value.lineIndex >= 0
  );
}
function sameAnchor(a: PdfNoteAnchor, b: PdfNoteAnchor): boolean {
  return (
    a.docId === b.docId && a.page === b.page && a.lineIndex === b.lineIndex
  );
}

// v1 accepts additive fields. Unknown versions and malformed records fail
// visibly instead of pretending to be empty (or overwriting future data).
function decode(value: unknown): NotesRecord {
  if (
    typeof value !== "object" ||
    value === null ||
    !("version" in value) ||
    value.version !== 1 ||
    !("notes" in value) ||
    !Array.isArray(value.notes)
  ) {
    throw new Error("无法读取笔记存储版本");
  }
  const notes: PdfNote[] = [];
  for (const note of value.notes) {
    if (
      typeof note !== "object" ||
      note === null ||
      !validAnchor(note) ||
      typeof note.lineText !== "string" ||
      !note.lineText.trim() ||
      typeof note.text !== "string" ||
      !note.text.trim() ||
      notes.some((other) => sameAnchor(other, note))
    ) {
      throw new Error("笔记存储损坏");
    }
    notes.push({
      docId: note.docId,
      page: note.page,
      lineIndex: note.lineIndex,
      lineText: note.lineText,
      text: note.text,
    });
  }
  return { version: 1, notes };
}

export function createPdfNotesStore(storage?: NamespaceStorage): PdfNotesStore {
  const record = createNamespaceRecord<unknown>("pdf-notes", empty, storage);
  let pendingWrites: Promise<unknown> = Promise.resolve();
  return {
    async list(docId) {
      await pendingWrites.catch(() => undefined);
      return decode(await record.read()).notes.filter(
        (note) => note.docId === docId
      );
    },
    save(anchor, text) {
      const run = record.update(async (raw, write) => {
        const data = decode(raw);
        if (!validAnchor(anchor) || !anchor.lineText.trim() || !text.trim())
          throw new Error("笔记正文不能为空");
        if (text.length > NOTE_TEXT_LIMIT)
          throw new Error("笔记正文最多 10,000 字符");
        const index = data.notes.findIndex((note) => sameAnchor(note, anchor));
        if (
          index < 0 &&
          data.notes.filter((note) => note.docId === anchor.docId).length >=
            NOTES_PER_BOOK_LIMIT
        ) {
          throw new Error("每书最多 100 条笔记");
        }
        const note = { ...anchor, text };
        if (index < 0) data.notes.push(note);
        else data.notes[index] = note;
        await write(data);
        return note;
      });
      pendingWrites = run;
      return run;
    },
    delete(anchor) {
      const run = record.update(async (raw, write) => {
        if (!validAnchor(anchor)) throw new Error("笔记落点无效");
        const data = decode(raw);
        const remaining = data.notes.filter(
          (note) => !sameAnchor(note, anchor)
        );
        if (remaining.length === data.notes.length) return;
        data.notes = remaining;
        await write(data);
      });
      pendingWrites = run;
      return run;
    },
  };
}

export function createChromePdfNotesStore(): PdfNotesStore {
  return createPdfNotesStore();
}

export function createMemoryPdfNotesStore(): PdfNotesStore {
  let bag: Record<string, unknown> = {};
  return createPdfNotesStore({
    async get() {
      return JSON.parse(JSON.stringify(bag));
    },
    async set(next) {
      bag = { ...bag, ...JSON.parse(JSON.stringify(next)) };
    },
  });
}
