import { useEffect, useState } from "react";

// Per-device preference storage on localStorage (ticket 05: the two
// annotation toggles and the font sizes share this). Since per-book
// persistence (per-book-toggles ticket 01) every key is book-scoped —
// `book:<id>:<pref>` — so different books keep different display settings;
// the old global `lingualeaf.<pref>` keys are read once as a migration
// fallback and never written. Every read and write is guarded: a broken
// localStorage (private browsing, blocked storage) must degrade to the
// default, never break rendering.

// The book-scoped key layout is a persistence contract: respelling it
// orphans every reader's saved preferences.
export function bookPrefKey(bookId: number, pref: string): string {
  return `book:${bookId}:${pref}`;
}

// The global-era layout this module wrote before per-book keys. Read-only:
// a reader's old values surface through the fallback and move onto the
// book key with the hooks' first write; the legacy key is never touched.
function legacyGlobalKey(pref: string): string {
  return `lingualeaf.${pref}`;
}

function parseStoredNumber(
  raw: string | null,
  fallback: number,
  clamp: (value: number) => number
): number {
  const value = raw === null ? Number.NaN : Number(raw);
  return Number.isFinite(value) ? clamp(value) : fallback;
}

function parseStoredBoolean(raw: string | null, fallback: boolean): boolean {
  if (raw === "true") return true;
  if (raw === "false") return false;
  return fallback;
}

// Book-scoped reads (per-book-toggles ticket 01): the book key speaks
// first; only when it is missing does the global-era key answer, so a
// reader's pre-per-book preference carries over exactly once. A book key
// that is present but garbage does NOT fall back — that book already has
// its own (corrupt) value, and the default applies. An invalid book id
// (an invalid route) reads as "no preference" without touching storage.
export function readStoredBookNumber(
  bookId: number,
  pref: string,
  fallback: number,
  clamp: (value: number) => number = (value) => value
): number {
  if (!Number.isInteger(bookId)) return fallback;
  try {
    const raw = window.localStorage.getItem(bookPrefKey(bookId, pref));
    if (raw !== null) return parseStoredNumber(raw, fallback, clamp);
    return parseStoredNumber(
      window.localStorage.getItem(legacyGlobalKey(pref)),
      fallback,
      clamp
    );
  } catch {
    return fallback;
  }
}

export function readStoredBookBoolean(
  bookId: number,
  pref: string,
  fallback: boolean
): boolean {
  if (!Number.isInteger(bookId)) return fallback;
  try {
    const raw = window.localStorage.getItem(bookPrefKey(bookId, pref));
    if (raw !== null) return parseStoredBoolean(raw, fallback);
    return parseStoredBoolean(
      window.localStorage.getItem(legacyGlobalKey(pref)),
      fallback
    );
  } catch {
    return fallback;
  }
}

// Book-scoped hooks (per-book-toggles ticket 01): reads go through the
// fallback chain above, writes land on the book key only — the write on
// mount or key change is what migrates a legacy value onto the book key.
export function useStoredBookNumber(
  bookId: number,
  pref: string,
  fallback: number,
  clamp: (value: number) => number = (value) => value
): [number, (value: number) => void] {
  const key = bookPrefKey(bookId, pref);
  const read = () => readStoredBookNumber(bookId, pref, fallback, clamp);
  // The useState initializer runs once per mount, but another book can
  // take over the mounted page (shelf → another book): this render-time
  // adjust re-reads whenever the key moves, so the state follows that
  // book's stored value instead of the previous one.
  const [prevKey, setPrevKey] = useState(key);
  const [value, setValue] = useState(read);
  if (prevKey !== key) {
    setPrevKey(key);
    setValue(read());
  }
  // The clamp applies at set time too, so the stored value stays in bounds
  // no matter who calls the setter.
  const setClamped = (next: number) => setValue(clamp(next));
  useEffect(() => {
    // An invalid book id (an invalid route) renders the error notice and
    // must leave no `book:NaN:*` litter in storage.
    if (!Number.isInteger(bookId)) return;
    try {
      window.localStorage.setItem(key, String(value));
    } catch {
      // Private browsing or blocked storage: the preference just does not
      // persist.
    }
  }, [key, value, bookId]);
  return [value, setClamped];
}

export function useStoredBookBoolean(
  bookId: number,
  pref: string,
  fallback: boolean
): [boolean, (value: boolean) => void] {
  const key = bookPrefKey(bookId, pref);
  const read = () => readStoredBookBoolean(bookId, pref, fallback);
  // Same book-follow stance as useStoredBookNumber.
  const [prevKey, setPrevKey] = useState(key);
  const [value, setValue] = useState(read);
  if (prevKey !== key) {
    setPrevKey(key);
    setValue(read());
  }
  useEffect(() => {
    if (!Number.isInteger(bookId)) return;
    try {
      window.localStorage.setItem(key, String(value));
    } catch {
      // Same stance as useStoredBookNumber.
    }
  }, [key, value, bookId]);
  return [value, setValue];
}
