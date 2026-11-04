import { fetchJson } from "./api";
import type {
  NoteAnchor,
  NoteContent,
  NoteResponse,
  NotesResponse,
  NoteSummary,
} from "../../server/src/wire";

export function fetchNotes(bookId: number): Promise<NoteSummary[]> {
  return fetchJson<NotesResponse>(`/api/books/${bookId}/notes`).then(
    (body) => body.notes
  );
}
export function createNote(
  bookId: number,
  anchor: NoteAnchor,
  content: NoteContent
): Promise<NoteSummary> {
  return fetchJson<NoteResponse>(`/api/books/${bookId}/notes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...anchor, ...content }),
  }).then((body) => body.note);
}
export function updateNote(
  bookId: number,
  id: number,
  content: NoteContent
): Promise<NoteSummary> {
  return fetchJson<NoteResponse>(`/api/books/${bookId}/notes/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(content),
  }).then((body) => body.note);
}
export function deleteNote(bookId: number, id: number): Promise<void> {
  return fetchJson<void>(`/api/books/${bookId}/notes/${id}`, {
    method: "DELETE",
  });
}
