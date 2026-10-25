import type Database from "better-sqlite3";
import type { Dictionary } from "./dict/dictionary.js";
import { lemmaOf } from "./dict/dictionary.js";
import { normalizeLookupToken } from "@lingualeaf/reading-model";
import type { WordStatus } from "./wire.js";

// The vocabulary store: every SQL statement over word_states lives here
// and nowhere else (book-store.ts idiom, pinned by the sql-locality
// gate's table→owner map). The interface is plain functions, database
// first; what the module hides: the column list, the insert-only shape of
// the auto-migration (ADR-0005: the lookup's New→learning is a pure
// INSERT, an existing row never moves), the idempotent set/clear pair the
// popup's operations compile to, and the token→lemma→state join the
// chapter payload rides on. schema.ts keeps the DDL, which runs before
// these shapes exist.

// The states a row can hold — the runtime mirror of the schema CHECK
// (SQL cannot import it), and the vocab router's validation list. New is
// a row's absence, never a value here.
export const WORD_STATUS_VALUES = ["learning", "known", "ignored"] as const;

// The columns every reader SELECT fetches, one list both readers
// interpolate (CODING_STANDARDS, "One table, one column list"); updated_at
// is write-only bookkeeping no reader needs.
const STATE_READ_COLUMNS = ["lemma", "status"] as const;
const stateColumnSql = STATE_READ_COLUMNS.join(", ");

// The lookup's write-and-read (ADR-0005's one automatic migration): an
// unstated lemma enters as 'learning' — a pure INSERT, no update path —
// and an existing row (known/ignored included) is left exactly as it is.
// Returns the lemma's status as the request leaves it, so the lookup
// response reflects the write it just performed.
export function learnWordIfAbsent(
  database: Database.Database,
  lemma: string
): WordStatus {
  const existing = database
    .prepare(`SELECT ${stateColumnSql} FROM word_states WHERE lemma = ?`)
    .get(lemma) as { status: WordStatus } | undefined;
  if (existing) return existing.status;
  database
    .prepare(
      "INSERT INTO word_states (lemma, status, updated_at) VALUES (?, 'learning', ?)"
    )
    .run(lemma, new Date().toISOString());
  return "learning";
}

// The popup's explicit set (ADR-0005: no server-side migration matrix —
// the legal moves are exactly the operations the popup offers, and any
// state may be set from any other). Idempotent upsert.
export function setWordState(
  database: Database.Database,
  lemma: string,
  status: WordStatus
): void {
  database
    .prepare(
      `INSERT INTO word_states (lemma, status, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(lemma) DO UPDATE SET
         status = excluded.status,
         updated_at = excluded.updated_at`
    )
    .run(lemma, status, new Date().toISOString());
}

// The popup's way back to New: the row is the state, so removal is the
// third operation. Idempotent — clearing an unstated lemma stays quiet.
export function clearWordState(
  database: Database.Database,
  lemma: string
): void {
  database.prepare("DELETE FROM word_states WHERE lemma = ?").run(lemma);
}

// The whole vocabulary as lemma → status — one SELECT per chapter request.
// The table holds one reader's vocabulary (thousands of rows at most), and
// the chapter join walks this map in memory instead of issuing a query
// per token (spec decision 5).
export function loadWordStatuses(
  database: Database.Database
): Map<string, WordStatus> {
  const rows = database
    .prepare(`SELECT ${stateColumnSql} FROM word_states`)
    .all() as { lemma: string; status: WordStatus }[];
  return new Map(rows.map((row) => [row.lemma, row.status]));
}

// One sentence's word tokens → their states, in token order — the join the
// chapter GET response carries (spec decision 5). The server does the word
// folding (the frontend renders statuses verbatim), through the exact key
// rule the lookup route writes: the dictionary's lemma, or the folded form
// when no inflection entry knows the word. A token with no state (New)
// reads null.
export function tokenStatuses(
  states: Map<string, WordStatus>,
  dictionary: Dictionary,
  tokens: string[]
): (WordStatus | null)[] {
  return tokens.map((token) => {
    const word = normalizeLookupToken(token);
    const key = lemmaOf(dictionary, word) ?? word;
    return states.get(key) ?? null;
  });
}
