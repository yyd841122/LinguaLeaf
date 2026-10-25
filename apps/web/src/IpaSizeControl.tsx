import { readStoredBookNumber, useStoredBookNumber } from "./prefs";
import { SizeStepper } from "./SizeStepper";

// IPA font size, in pixels. Adjusted per device and remembered per book
// (book:<id>:ipaSize, per-book-toggles ticket 01; the pattern ticket 05
// generalized for the toggles and the other sizes). Exported bounds keep the stepper, the storage
// reader, and the settings UI in agreement.
export const MIN_IPA_SIZE = 9;
export const MAX_IPA_SIZE = 20;
export const DEFAULT_IPA_SIZE = 12;

// The <pref> half of the book-scoped storage key (book:<id>:<pref>).
const IPA_SIZE_PREF = "ipaSize";

export function clampIpaSize(value: number): number {
  return Math.min(MAX_IPA_SIZE, Math.max(MIN_IPA_SIZE, value));
}

// Reads the remembered size; any garbage (or a broken localStorage, e.g.
// private browsing) falls back to the default instead of throwing.
export function readStoredIpaSize(bookId: number): number {
  return readStoredBookNumber(
    bookId,
    IPA_SIZE_PREF,
    DEFAULT_IPA_SIZE,
    clampIpaSize
  );
}

export function IpaSizeControl({
  size,
  onChange,
}: {
  size: number;
  onChange: (size: number) => void;
}) {
  return (
    <SizeStepper
      label="音标"
      size={size}
      min={MIN_IPA_SIZE}
      max={MAX_IPA_SIZE}
      onChange={(next) => onChange(clampIpaSize(next))}
    />
  );
}

// Owns the persisted state so ReadingPage just consumes size + setter.
export function useIpaSize(bookId: number): [number, (size: number) => void] {
  return useStoredBookNumber(
    bookId,
    IPA_SIZE_PREF,
    DEFAULT_IPA_SIZE,
    clampIpaSize
  );
}
