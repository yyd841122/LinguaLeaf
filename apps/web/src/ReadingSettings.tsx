import { readStoredNumber, useStoredBoolean, useStoredNumber } from "./prefs";
import { IpaSizeControl } from "./IpaSizeControl";
import { SizeStepper } from "./SizeStepper";

// Original-line (原文行) font size, in pixels, adjusted per device and
// remembered in localStorage alongside the IPA size and the two toggles.
// Exported bounds keep the stepper, the storage reader, and the reading
// view's CSS variable in agreement.
export const MIN_ORIGINAL_SIZE = 14;
export const MAX_ORIGINAL_SIZE = 28;
export const DEFAULT_ORIGINAL_SIZE = 18;

// Translation-line (译文行) font size: the dimmer auxiliary line runs a
// touch smaller than the original and gets the same per-device memory.
export const MIN_TRANSLATION_SIZE = 12;
export const MAX_TRANSLATION_SIZE = 24;
export const DEFAULT_TRANSLATION_SIZE = 14;

const ORIGINAL_SIZE_STORAGE_KEY = "lingualeaf.originalSize";
const TRANSLATION_SIZE_STORAGE_KEY = "lingualeaf.translationSize";
const SHOW_IPA_STORAGE_KEY = "lingualeaf.showIpa";
const SHOW_TRANSLATION_STORAGE_KEY = "lingualeaf.showTranslation";

export function clampOriginalSize(value: number): number {
  return Math.min(MAX_ORIGINAL_SIZE, Math.max(MIN_ORIGINAL_SIZE, value));
}

export function clampTranslationSize(value: number): number {
  return Math.min(MAX_TRANSLATION_SIZE, Math.max(MIN_TRANSLATION_SIZE, value));
}

export function readStoredOriginalSize(): number {
  return readStoredNumber(
    ORIGINAL_SIZE_STORAGE_KEY,
    DEFAULT_ORIGINAL_SIZE,
    clampOriginalSize
  );
}

export function readStoredTranslationSize(): number {
  return readStoredNumber(
    TRANSLATION_SIZE_STORAGE_KEY,
    DEFAULT_TRANSLATION_SIZE,
    clampTranslationSize
  );
}

export function useOriginalSize(): [number, (size: number) => void] {
  return useStoredNumber(
    ORIGINAL_SIZE_STORAGE_KEY,
    DEFAULT_ORIGINAL_SIZE,
    clampOriginalSize
  );
}

export function useTranslationSize(): [number, (size: number) => void] {
  return useStoredNumber(
    TRANSLATION_SIZE_STORAGE_KEY,
    DEFAULT_TRANSLATION_SIZE,
    clampTranslationSize
  );
}

// The annotation toggles (显示开关, GLOSSARY). Both annotation lines start
// visible; the original line has no toggle — it is never hidden.
export function useShowIpa(): [boolean, (value: boolean) => void] {
  return useStoredBoolean(SHOW_IPA_STORAGE_KEY, true);
}

export function useShowTranslation(): [boolean, (value: boolean) => void] {
  return useStoredBoolean(SHOW_TRANSLATION_STORAGE_KEY, true);
}

export function OriginalSizeControl({
  size,
  onChange,
}: {
  size: number;
  onChange: (size: number) => void;
}) {
  return (
    <SizeStepper
      label="原文"
      size={size}
      min={MIN_ORIGINAL_SIZE}
      max={MAX_ORIGINAL_SIZE}
      onChange={(next) => onChange(clampOriginalSize(next))}
    />
  );
}

export function TranslationSizeControl({
  size,
  onChange,
}: {
  size: number;
  onChange: (size: number) => void;
}) {
  return (
    <SizeStepper
      label="译文"
      size={size}
      min={MIN_TRANSLATION_SIZE}
      max={MAX_TRANSLATION_SIZE}
      onChange={(next) => onChange(clampTranslationSize(next))}
    />
  );
}

// The reading settings panel: the two annotation toggles plus all three
// font size steppers in one place (ticket 05). Controlled throughout — the
// page owns the persisted state, this only renders and reports.
export function ReadingSettings({
  showIpa,
  onShowIpaChange,
  showTranslation,
  onShowTranslationChange,
  translationLinesAvailable,
  ipaSize,
  onIpaSizeChange,
  originalSize,
  onOriginalSizeChange,
  translationSize,
  onTranslationSizeChange,
}: {
  showIpa: boolean;
  onShowIpaChange: (value: boolean) => void;
  showTranslation: boolean;
  onShowTranslationChange: (value: boolean) => void;
  // The chapter-level gate (ticket 03): with no translation line in the
  // chapter to show, the 译文行 toggle grays — there is nothing it could
  // toggle. The preference itself is untouched; it applies again the
  // moment the chapter gains translations.
  translationLinesAvailable: boolean;
  ipaSize: number;
  onIpaSizeChange: (size: number) => void;
  originalSize: number;
  onOriginalSizeChange: (size: number) => void;
  translationSize: number;
  onTranslationSizeChange: (size: number) => void;
}) {
  return (
    <div className="reading-settings">
      <label className="setting-toggle">
        <input
          type="checkbox"
          checked={showIpa}
          onChange={(event) => onShowIpaChange(event.target.checked)}
        />
        音标行
      </label>
      <label className="setting-toggle">
        <input
          type="checkbox"
          checked={showTranslation}
          disabled={!translationLinesAvailable}
          onChange={(event) => onShowTranslationChange(event.target.checked)}
        />
        译文行
      </label>
      <IpaSizeControl size={ipaSize} onChange={onIpaSizeChange} />
      <OriginalSizeControl
        size={originalSize}
        onChange={onOriginalSizeChange}
      />
      <TranslationSizeControl
        size={translationSize}
        onChange={onTranslationSizeChange}
      />
    </div>
  );
}
