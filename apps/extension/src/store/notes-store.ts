import {
  createNamespaceRecord,
  type NamespaceStorage,
} from "./namespace-record";

// Positions count ALL chapter.blocks, including code/raw/image, from zero.
export type NoteAnchor = {
  docId: string;
  chapterIndex: number;
  blockIndex: number;
};
export type ReaderNote = NoteAnchor & { text: string };
export interface NotesStore {
  list(docId: string): Promise<ReaderNote[]>;
  save(anchor: NoteAnchor, text: string): Promise<ReaderNote>;
  delete(anchor: NoteAnchor): Promise<void>;
}

export const NOTE_TEXT_LIMIT = 10_000;
export const NOTES_PER_BOOK_LIMIT = 100;
type NotesRecord = { version: 1; notes: ReaderNote[] };
const empty = (): NotesRecord => ({ version: 1, notes: [] });

function validAnchor(value: NoteAnchor): boolean {
  return (
    typeof value.docId === "string" &&
    value.docId.length > 0 &&
    Number.isInteger(value.chapterIndex) &&
    value.chapterIndex >= 0 &&
    Number.isInteger(value.blockIndex) &&
    value.blockIndex >= 0
  );
}
function sameAnchor(a: NoteAnchor, b: NoteAnchor): boolean {
  return (
    a.docId === b.docId &&
    a.chapterIndex === b.chapterIndex &&
    a.blockIndex === b.blockIndex
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
  const notes: ReaderNote[] = [];
  for (const note of value.notes) {
    if (
      typeof note !== "object" ||
      note === null ||
      !validAnchor(note) ||
      typeof note.text !== "string" ||
      !note.text.trim() ||
      notes.some((other) => sameAnchor(other, note))
    ) {
      throw new Error("笔记存储损坏");
    }
    notes.push({
      docId: note.docId,
      chapterIndex: note.chapterIndex,
      blockIndex: note.blockIndex,
      text: note.text,
    });
  }
  return { version: 1, notes };
}

export function createNotesStore(storage: NamespaceStorage): NotesStore {
  const record = createNamespaceRecord<unknown>("notes", empty, storage);
  return {
    async list(docId) {
      return decode(await record.read()).notes.filter(
        (note) => note.docId === docId
      );
    },
    save(anchor, text) {
      return record.update(async (raw, write) => {
        const data = decode(raw);
        if (!validAnchor(anchor) || !text.trim())
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
    },
    delete(anchor) {
      return record.update(async (raw, write) => {
        if (!validAnchor(anchor)) throw new Error("笔记落点无效");
        const data = decode(raw);
        data.notes = data.notes.filter((note) => !sameAnchor(note, anchor));
        await write(data);
      });
    },
  };
}

export function createChromeNotesStore(): NotesStore {
  return createNotesStore(chrome.storage.local);
}

export function createMemoryNotesStore(): NotesStore {
  let bag: Record<string, unknown> = {};
  return createNotesStore({
    async get() {
      return JSON.parse(JSON.stringify(bag));
    },
    async set(next) {
      bag = JSON.parse(JSON.stringify(next));
    },
  });
}
