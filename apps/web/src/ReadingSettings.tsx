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

const ORIGINAL_SIZE_STORAGE_KEY = "lingualeaf.originalSize";
const SHOW_IPA_STORAGE_KEY = "lingualeaf.showIpa";
const SHOW_TRANSLATION_STORAGE_KEY = "lingualeaf.showTranslation";

export function clampOriginalSize(value: number): number {
  return Math.min(MAX_ORIGINAL_SIZE, Math.max(MIN_ORIGINAL_SIZE, value));
}

export function readStoredOriginalSize(): number {
  return readStoredNumber(
    ORIGINAL_SIZE_STORAGE_KEY,
    DEFAULT_ORIGINAL_SIZE,
    clampOriginalSize
  );
}

export function useOriginalSize(): [number, (size: number) => void] {
  return useStoredNumber(
    ORIGINAL_SIZE_STORAGE_KEY,
    DEFAULT_ORIGINAL_SIZE,
    clampOriginalSize
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

// The reading settings panel: the two annotation toggles plus both font
// size steppers in one place (ticket 05). Controlled throughout — the page
// owns the persisted state, this only renders and reports.
export function ReadingSettings({
  showIpa,
  onShowIpaChange,
  showTranslation,
  onShowTranslationChange,
  ipaSize,
  onIpaSizeChange,
  originalSize,
  onOriginalSizeChange,
}: {
  showIpa: boolean;
  onShowIpaChange: (value: boolean) => void;
  showTranslation: boolean;
  onShowTranslationChange: (value: boolean) => void;
  ipaSize: number;
  onIpaSizeChange: (size: number) => void;
  originalSize: number;
  onOriginalSizeChange: (size: number) => void;
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
          onChange={(event) => onShowTranslationChange(event.target.checked)}
        />
        译文行
      </label>
      <IpaSizeControl size={ipaSize} onChange={onIpaSizeChange} />
      <OriginalSizeControl
        size={originalSize}
        onChange={onOriginalSizeChange}
      />
    </div>
  );
}
