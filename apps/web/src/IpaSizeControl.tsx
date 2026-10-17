import { readStoredNumber, useStoredNumber } from "./prefs";
import { SizeStepper } from "./SizeStepper";

// IPA font size, in pixels. Adjusted per device and remembered in
// localStorage (the pattern ticket 05 generalized for the toggles and the
// original-text size). Exported bounds keep the stepper, the storage
// reader, and the settings UI in agreement.
export const MIN_IPA_SIZE = 9;
export const MAX_IPA_SIZE = 20;
export const DEFAULT_IPA_SIZE = 12;

const IPA_SIZE_STORAGE_KEY = "lingualeaf.ipaSize";

export function clampIpaSize(value: number): number {
  return Math.min(MAX_IPA_SIZE, Math.max(MIN_IPA_SIZE, value));
}

// Reads the remembered size; any garbage (or a broken localStorage, e.g.
// private browsing) falls back to the default instead of throwing.
export function readStoredIpaSize(): number {
  return readStoredNumber(IPA_SIZE_STORAGE_KEY, DEFAULT_IPA_SIZE, clampIpaSize);
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
export function useIpaSize(): [number, (size: number) => void] {
  return useStoredNumber(IPA_SIZE_STORAGE_KEY, DEFAULT_IPA_SIZE, clampIpaSize);
}
