import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDatabase } from "../src/database.js";
import {
  clearWordState,
  learnWordIfAbsent,
  loadWordStatuses,
  setWordState,
  tokenStatuses,
} from "../src/vocab-store.js";
import { createFixtureDictionary } from "./fixtures/dictionary.js";

// Direct store tests: no HTTP — the word_states table's SQL is the whole
// surface here (the vocab-store seam, ADR-0005 ticket 01). The wire shapes
// stay pinned by the api and contract suites; these pin what those cannot
// see: the insert-only auto-migration, the idempotent set/clear pair, and
// the token→lemma→state join the chapter payload rides on.
describe("vocab-store", () => {
  let database: Database.Database;
  let dictionary: ReturnType<typeof createFixtureDictionary>;

  beforeEach(() => {
    database = openDatabase(":memory:");
    dictionary = createFixtureDictionary();
  });
  afterEach(() => {
    database.close();
    dictionary.close();
  });

  it("learns an unstated lemma as learning — the one automatic migration", () => {
    expect(learnWordIfAbsent(database, "book")).toBe("learning");
    expect(loadWordStatuses(database).get("book")).toBe("learning");
  });

  it("leaves an existing row exactly as it is — known and ignored never move", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-25T08:00:00.000Z"));
    setWordState(database, "book", "known");
    // A later lookup on the same lemma must not touch the row: status and
    // the write-only timestamp both stay at what the explicit set wrote.
    vi.setSystemTime(new Date("2026-10-25T09:00:00.000Z"));
    expect(learnWordIfAbsent(database, "book")).toBe("known");
    const row = database
      .prepare("SELECT status, updated_at FROM word_states WHERE lemma = ?")
      .get("book") as { status: string; updated_at: string };
    expect(row.status).toBe("known");
    expect(row.updated_at).toBe("2026-10-25T08:00:00.000Z");
    vi.useRealTimers();
  });

  it("sets any state from any state, idempotently", () => {
    setWordState(database, "book", "learning");
    setWordState(database, "book", "known");
    setWordState(database, "book", "ignored");
    setWordState(database, "book", "ignored");
    expect(loadWordStatuses(database).get("book")).toBe("ignored");
    const rows = database
      .prepare("SELECT COUNT(*) AS n FROM word_states WHERE lemma = ?")
      .get("book") as { n: number };
    expect(rows.n).toBe(1);
  });

  it("clears a lemma back to New — a later lookup learns it again", () => {
    setWordState(database, "book", "known");
    clearWordState(database, "book");
    expect(loadWordStatuses(database).has("book")).toBe(false);
    // Clearing an unstated lemma stays quiet (idempotent), and New is the
    // row's absence: the next lookup re-enters at learning.
    expect(() => clearWordState(database, "book")).not.toThrow();
    expect(learnWordIfAbsent(database, "book")).toBe("learning");
  });

  it("loads the whole vocabulary as a lemma→status map", () => {
    setWordState(database, "book", "known");
    setWordState(database, "go", "ignored");
    expect(loadWordStatuses(database)).toEqual(
      new Map([
        ["book", "known"],
        ["go", "ignored"],
      ])
    );
  });

  it("joins token states through the fold and the lemma, token order kept", () => {
    // Keys are exactly what the lookup route writes: the lemma, or the
    // folded form when no inflection entry knows the word. Surface forms
    // ("Books", curly apostrophes) fold to the same key.
    setWordState(database, "book", "known");
    setWordState(database, "go", "ignored");
    setWordState(database, "don't", "learning");
    expect(
      tokenStatuses(loadWordStatuses(database), dictionary, [
        "Books,",
        "went",
        "don’t",
        "zebra",
      ])
    ).toEqual(["known", "ignored", "learning", null]);
  });
});
