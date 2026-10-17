import { useEffect, useState } from "react";

// IPA font size, in pixels. Adjusted per device and remembered in
// localStorage (the same per-device memory ticket 05 gives the toggles and
// body font size). Exported bounds keep the stepper, the storage reader, and
// any future settings UI in agreement.
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
  try {
    const raw = window.localStorage.getItem(IPA_SIZE_STORAGE_KEY);
    const value = raw === null ? Number.NaN : Number(raw);
    return Number.isFinite(value) ? clampIpaSize(value) : DEFAULT_IPA_SIZE;
  } catch {
    return DEFAULT_IPA_SIZE;
  }
}

export function IpaSizeControl({
  size,
  onChange,
}: {
  size: number;
  onChange: (size: number) => void;
}) {
  return (
    <div className="ipa-size-control">
      <button
        type="button"
        aria-label="调小音标字号"
        disabled={size <= MIN_IPA_SIZE}
        onClick={() => onChange(clampIpaSize(size - 1))}
      >
        A−
      </button>
      <span className="ipa-size-value" aria-live="polite">
        音标 {size}
      </span>
      <button
        type="button"
        aria-label="调大音标字号"
        disabled={size >= MAX_IPA_SIZE}
        onClick={() => onChange(clampIpaSize(size + 1))}
      >
        A+
      </button>
    </div>
  );
}

// Owns the persisted state so ReadingPage just consumes size + setter.
export function useIpaSize(): [number, (size: number) => void] {
  const [size, setSize] = useState<number>(() => readStoredIpaSize());
  useEffect(() => {
    try {
      window.localStorage.setItem(IPA_SIZE_STORAGE_KEY, String(size));
    } catch {
      // Private browsing or blocked storage: the size just does not persist.
    }
  }, [size]);
  return [size, setSize];
}
