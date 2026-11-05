import { useCallback, useEffect, useRef, useState } from "react";
import { useOwner, useSettle } from "@lingualeaf/reading-model/react";
import type {
  NoteAnchor,
  NoteContent,
  NoteSummary,
} from "../../server/src/wire";
import { NOTE_TYPES } from "../../server/src/wire";
import { ApiError } from "./api";
import { createNote, deleteNote, fetchNotes, updateNote } from "./notes";

export type NoteOperation =
  | { outcome: "saved"; note?: NoteSummary }
  | { outcome: "conflict"; note: NoteSummary }
  | { outcome: "failed" | "stale" | "busy" };

const sortNotes = (notes: NoteSummary[]) =>
  notes.sort(
    (a, b) =>
      (a.chapter ?? 0) - (b.chapter ?? 0) ||
      (a.block ?? 0) - (b.block ?? 0) ||
      NOTE_TYPES.indexOf(a.type) - NOTE_TYPES.indexOf(b.type)
  );

export function useNotesSession({ bookId }: { bookId: number }) {
  const owner = useOwner(bookId);
  const { failed, run, clear } = useSettle(owner);
  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const state = useRef({
    bookId,
    notes: [] as NoteSummary[],
    loaded: false,
    pending: new Set<string>(),
    deleted: new Set<number>(),
  });
  if (!Object.is(state.current.bookId, bookId)) {
    owner.invalidate();
    state.current = {
      bookId,
      notes: [],
      loaded: false,
      pending: new Set(),
      deleted: new Set(),
    };
    setNotes([]);
    setLoaded(false);
    setPending(new Set());
  }

  const merge = useCallback((incoming: NoteSummary[]) => {
    const current = state.current;
    const rows = new Map(current.notes.map((note) => [note.id, note]));
    for (const note of incoming) {
      const old = rows.get(note.id);
      if (
        !current.deleted.has(note.id) &&
        (!old || note.updatedAt > old.updatedAt)
      )
        rows.set(note.id, note);
    }
    current.notes = sortNotes([...rows.values()]);
    setNotes(current.notes);
  }, []);

  const refresh = useCallback(async () => {
    if (!Number.isSafeInteger(bookId) || bookId < 1) return;
    await run(fetchNotes(bookId), {
      onFresh: (incoming) => {
        merge(incoming);
        state.current.loaded = true;
        setLoaded(true);
      },
    });
  }, [bookId, run, merge]);

  useEffect(() => {
    owner.invalidate();
    clear();
    void refresh();
    return () => owner.invalidate();
  }, [owner, refresh, clear]);

  const keyFor = (anchor: Pick<NoteSummary, "chapter" | "block" | "type">) =>
    `${anchor.chapter}:${anchor.block}:${anchor.type}`;
  const operate = async <T extends NoteOperation>(
    anchor: Pick<NoteSummary, "chapter" | "block" | "type">,
    action: () => Promise<T>,
    onFresh: (result: T) => void
  ): Promise<NoteOperation> => {
    const current = state.current;
    const key = keyFor(anchor);
    if (!current.loaded || current.pending.has(key)) return { outcome: "busy" };
    current.pending.add(key);
    setPending(new Set(current.pending));
    const ticket = owner.mark();
    try {
      const result = await run(action(), { ticket, onFresh });
      if (!result.fresh) return { outcome: "stale" };
      if (!result.ok) return { outcome: "failed" };
      return result.value;
    } finally {
      current.pending.delete(key);
      if (!ticket.stale()) setPending(new Set(current.pending));
    }
  };

  const save = (
    anchor: NoteAnchor,
    noteId: number | null,
    content: NoteContent
  ) => {
    return operate(
      { ...anchor, type: content.type },
      async () => {
        try {
          const note = await (noteId === null
            ? createNote(bookId, anchor, content)
            : updateNote(bookId, noteId, { text: content.text }));
          return { outcome: "saved" as const, note };
        } catch (error) {
          if (
            error instanceof ApiError &&
            error.body?.code === "note-exists" &&
            error.body.note
          ) {
            const note = error.body.note as NoteSummary;
            return { outcome: "conflict" as const, note };
          }
          throw error;
        }
      },
      (result) => merge([result.note])
    );
  };
  const remove = (note: NoteSummary) => {
    return operate(
      note,
      async () => {
        await deleteNote(bookId, note.id);
        return { outcome: "saved" as const };
      },
      () => {
        state.current.deleted.add(note.id);
        state.current.notes = state.current.notes.filter(
          (row) => row.id !== note.id
        );
        setNotes(state.current.notes);
      }
    );
  };
  return { notes, loaded, failed, refresh, save, remove, pending };
}
