import { useEffect, useState } from "react";

// Per-device preference storage on localStorage (ticket 05: the two
// annotation toggles and both font sizes share this). Every read and write
// is guarded: a broken localStorage (private browsing, blocked storage)
// must degrade to the default, never break rendering.

export function readStoredNumber(
  key: string,
  fallback: number,
  clamp: (value: number) => number = (value) => value
): number {
  try {
    const raw = window.localStorage.getItem(key);
    const value = raw === null ? Number.NaN : Number(raw);
    return Number.isFinite(value) ? clamp(value) : fallback;
  } catch {
    return fallback;
  }
}

export function readStoredBoolean(key: string, fallback: boolean): boolean {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === "true") return true;
    if (raw === "false") return false;
    return fallback;
  } catch {
    return fallback;
  }
}

export function useStoredNumber(
  key: string,
  fallback: number,
  clamp: (value: number) => number = (value) => value
): [number, (value: number) => void] {
  const [value, setValue] = useState<number>(() =>
    readStoredNumber(key, fallback, clamp)
  );
  // The clamp applies at set time too, so the stored value stays in bounds
  // no matter who calls the setter.
  const setClamped = (next: number) => setValue(clamp(next));
  useEffect(() => {
    try {
      window.localStorage.setItem(key, String(value));
    } catch {
      // Private browsing or blocked storage: the preference just does not
      // persist.
    }
  }, [key, value]);
  return [value, setClamped];
}

export function useStoredBoolean(
  key: string,
  fallback: boolean
): [boolean, (value: boolean) => void] {
  const [value, setValue] = useState<boolean>(() =>
    readStoredBoolean(key, fallback)
  );
  useEffect(() => {
    try {
      window.localStorage.setItem(key, String(value));
    } catch {
      // Same stance as useStoredNumber.
    }
  }, [key, value]);
  return [value, setValue];
}
