import type { ReviewNotesResponse } from "../../server/src/wire";
import { fetchJson } from "./api";

export async function fetchReviewNotes() {
  return (await fetchJson<ReviewNotesResponse>("/api/review/notes")).entries;
}
