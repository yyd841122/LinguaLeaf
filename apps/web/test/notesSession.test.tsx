import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { useNotesSession } from "../src/notesSession";
import { createNote, deleteNote, fetchNotes, updateNote } from "../src/notes";
import type { NoteSummary } from "../../server/src/wire";
import { ApiError } from "../src/api";

vi.mock("../src/notes", () => ({
  createNote: vi.fn(),
  deleteNote: vi.fn(),
  fetchNotes: vi.fn(),
  updateNote: vi.fn(),
}));
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const row = (
  text = "Original",
  updatedAt = "2026-11-04T00:00:00.000Z"
): NoteSummary => ({
  id: 1,
  chapter: 1,
  block: 1,
  type: "idea",
  text,
  createdAt: "2026-11-04T00:00:00.000Z",
  updatedAt,
});
const anchor = { chapter: 1, block: 1 };
const content = { type: "idea" as const, text: "Changed" };
const flush = () => act(async () => {});
beforeEach(() => vi.resetAllMocks());

it("disables writes until initial GET succeeds, exposes failure and retries", async () => {
  const get = deferred<NoteSummary[]>();
  vi.mocked(fetchNotes).mockReturnValueOnce(get.promise).mockResolvedValue([]);
  const { result } = renderHook(() => useNotesSession({ bookId: 7 }));
  await expect(result.current.save(anchor, null, content)).resolves.toEqual({
    outcome: "busy",
  });
  expect(createNote).not.toHaveBeenCalled();
  await act(async () => get.reject(new Error("offline")));
  expect(result.current.failed).toBe(true);
  expect(result.current.loaded).toBe(false);
  await act(async () => {
    await result.current.refresh();
  });
  expect(result.current.loaded).toBe(true);
  expect(result.current.failed).toBe(false);
});

it("merges a delayed refetch without rewinding a completed save or resurrecting a deletion", async () => {
  const get = deferred<NoteSummary[]>();
  vi.mocked(fetchNotes)
    .mockResolvedValueOnce([row()])
    .mockReturnValueOnce(get.promise);
  vi.mocked(updateNote).mockResolvedValue(
    row("Changed", "2026-11-04T00:00:01.000Z")
  );
  vi.mocked(deleteNote).mockResolvedValue();
  const { result } = renderHook(() => useNotesSession({ bookId: 7 }));
  await flush();
  let refresh!: Promise<void>;
  act(() => {
    refresh = result.current.refresh();
  });
  await act(async () => {
    await result.current.save(anchor, 1, content);
  });
  expect(result.current.notes[0]?.text).toBe("Changed");
  await act(async () => get.resolve([row()]));
  await refresh;
  expect(result.current.notes[0]?.text).toBe("Changed");
  const old = deferred<NoteSummary[]>();
  vi.mocked(fetchNotes).mockReturnValueOnce(old.promise);
  act(() => {
    refresh = result.current.refresh();
  });
  await act(async () => {
    await result.current.remove(row());
  });
  expect(result.current.notes).toEqual([]);
  await act(async () => old.resolve([row()]));
  await refresh;
  expect(result.current.notes).toEqual([]);
});

it("serializes double save and save/delete races per anchor", async () => {
  vi.mocked(fetchNotes).mockResolvedValue([row()]);
  const put = deferred<NoteSummary>();
  vi.mocked(updateNote).mockReturnValueOnce(put.promise);
  const { result } = renderHook(() => useNotesSession({ bookId: 7 }));
  await flush();
  let first!: ReturnType<typeof result.current.save>;
  act(() => {
    first = result.current.save(anchor, 1, content);
  });
  await expect(result.current.save(anchor, 1, content)).resolves.toEqual({
    outcome: "busy",
  });
  await expect(result.current.remove(row())).resolves.toEqual({
    outcome: "busy",
  });
  expect(updateNote).toHaveBeenCalledTimes(1);
  expect(deleteNote).not.toHaveBeenCalled();
  await act(async () =>
    put.resolve(row("Changed", "2026-11-04T00:00:01.000Z"))
  );
  await expect(first).resolves.toEqual({ outcome: "saved" });
  expect(result.current.pending.size).toBe(0);
});

it("revokes first-pass GET and writes across A → B → A, even from a lit failure flag", async () => {
  const oldGet = deferred<NoteSummary[]>();
  const oldPut = deferred<NoteSummary>();
  vi.mocked(fetchNotes)
    .mockResolvedValueOnce([row()])
    .mockReturnValueOnce(oldGet.promise)
    .mockRejectedValueOnce(new Error("current outage"));
  vi.mocked(updateNote).mockReturnValue(oldPut.promise);
  const { result, rerender } = renderHook(useNotesSession, {
    initialProps: { bookId: 7 },
  });
  await flush();
  let put!: ReturnType<typeof result.current.save>;
  act(() => {
    put = result.current.save(anchor, 1, content);
  });
  rerender({ bookId: 8 });
  rerender({ bookId: 7 });
  await flush();
  expect(result.current.notes).toEqual([]);
  expect(result.current.failed).toBe(true);
  await act(async () => {
    oldGet.resolve([row("Stale GET")]);
    oldPut.resolve(row("Stale write"));
  });
  await expect(put).resolves.toEqual({ outcome: "stale" });
  expect(result.current.notes).toEqual([]);
  expect(result.current.failed).toBe(true);
});

it("turns a duplicate POST into editing the existing note without swallowing a new draft", async () => {
  vi.mocked(fetchNotes).mockResolvedValue([]);
  vi.mocked(createNote).mockRejectedValue(
    new ApiError(409, "/notes", "POST", { code: "note-exists", note: row() })
  );
  const { result } = renderHook(() => useNotesSession({ bookId: 7 }));
  await flush();
  await act(async () => {
    expect(await result.current.save(anchor, null, content)).toEqual({
      outcome: "conflict",
      note: row(),
    });
  });
  expect(result.current.notes).toEqual([row()]);
});

it("does not revive an initial A read after A → B → A has loaded a different collection", async () => {
  const first = deferred<NoteSummary[]>();
  const latest = { ...row("Current A"), id: 4 };
  vi.mocked(fetchNotes)
    .mockReturnValueOnce(first.promise)
    .mockResolvedValueOnce([{ ...row("Book B"), id: 3 }])
    .mockResolvedValueOnce([latest]);
  const { result, rerender } = renderHook(useNotesSession, {
    initialProps: { bookId: 7 },
  });
  rerender({ bookId: 8 });
  await flush();
  expect(result.current.notes[0]?.text).toBe("Book B");
  rerender({ bookId: 7 });
  await flush();
  expect(result.current.notes).toEqual([latest]);
  await act(async () => first.resolve([row("First A")]));
  expect(result.current.notes).toEqual([latest]);
});

it("blocks a save during deletion and keeps another anchor pending when one operation settles", async () => {
  const other = { ...row(), id: 2, block: 2 };
  vi.mocked(fetchNotes).mockResolvedValue([row(), other]);
  const deletion = deferred<void>();
  const saving = deferred<NoteSummary>();
  vi.mocked(deleteNote).mockReturnValue(deletion.promise);
  vi.mocked(updateNote).mockReturnValue(saving.promise);
  const { result } = renderHook(() => useNotesSession({ bookId: 7 }));
  await flush();
  let remove!: ReturnType<typeof result.current.remove>;
  let save!: ReturnType<typeof result.current.save>;
  act(() => {
    remove = result.current.remove(row());
    save = result.current.save({ chapter: 1, block: 2 }, 2, content);
  });
  await expect(result.current.save(anchor, 1, content)).resolves.toEqual({
    outcome: "busy",
  });
  expect(result.current.pending.size).toBe(2);
  await act(async () => deletion.resolve());
  await remove;
  expect(result.current.pending).toEqual(new Set(["1:2"]));
  await act(async () =>
    saving.resolve({
      ...other,
      text: "Changed",
      updatedAt: "2026-11-04T00:00:01.000Z",
    })
  );
  await save;
  expect(result.current.pending.size).toBe(0);
  expect(result.current.notes.map((note) => note.id)).toEqual([2]);
});
