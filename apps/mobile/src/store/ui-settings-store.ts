import {
  createNamespaceRecord,
  type NamespaceStorage,
} from "./namespace-record";

// The reader's global face preferences. Redesign ticket 01 added the
// manual theme choice (暖纸 | 白 | 夜间 | 跟随系统 — the default follows
// the system so ticket 06's dark-follow readers keep their dark); ticket
// 02 adds the typography ladder (字号 5 档 / 边距 3 档 / 行距 3 档, one
// global choice per the spec, per-book learning toggles live in their
// own store). The version 1 pdfToolbar item retired with ticket 01's
// migration (ticket 02 removes its UI). Read failures degrade to the
// default (convenience settings never block reading — the pdf-position
// store's same policy).

export type ThemePreference = "paper" | "white" | "night" | "system";

// The ladders the Aa panel steps through (spec round 2: 字号 5 档、边距
// 3 档默认宽、行距 3 档默认 1.75). Steps are stored as indices; the
// values live here once — the Aa panel renders from the same constants.
export const FONT_STEPS = ["1rem", "1.15rem", "1.3rem", "1.45rem", "1.6rem"];
// The margin ladder carries its labels beside its values — a parallel
// label array indexed by position was the review's Primitive Obsession
// catch (a fourth step would have rendered undefined).
export const MARGIN_STEPS = [
  ["12%", "窄"],
  ["17%", "适中"],
  ["22%", "宽"],
] as const;
export const LINE_STEPS = ["1.5", "1.75", "2"];
export const DEFAULT_TYPOGRAPHY = {
  fontStep: 1, // 1.15rem — today's --original-size fallback
  marginStep: 2, // 22% — the reference image's wide margin
  lineStep: 1, // 1.75 — the reference image's leading
} as const;

export type Typography = {
  fontStep: number;
  marginStep: number;
  lineStep: number;
};
export type UiSettings = { theme: ThemePreference; typography: Typography };

export interface UiSettingsStore {
  load(): Promise<UiSettings>;
  saveTheme(theme: ThemePreference): Promise<void>;
  saveTypography(steps: Partial<Typography>): Promise<void>;
}

type StoredRecord = {
  version: 3;
  theme: ThemePreference;
  typography: Typography;
};
const empty = (): StoredRecord => ({
  version: 3,
  theme: "system",
  typography: { ...DEFAULT_TYPOGRAPHY },
});

const isThemePreference = (value: unknown): value is ThemePreference =>
  value === "paper" ||
  value === "white" ||
  value === "night" ||
  value === "system";

// A ladder index is valid only inside its own ladder; anything else
// (corrupt record, hand-edited) degrades to that ladder's default.
const step = (value: unknown, max: number, fallback: number): number =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= 0 &&
  value < max
    ? value
    : fallback;

const decodeTypography = (raw: unknown): Typography => ({
  fontStep: step(
    (raw as { fontStep?: unknown } | undefined)?.fontStep,
    FONT_STEPS.length,
    DEFAULT_TYPOGRAPHY.fontStep
  ),
  marginStep: step(
    (raw as { marginStep?: unknown } | undefined)?.marginStep,
    MARGIN_STEPS.length,
    DEFAULT_TYPOGRAPHY.marginStep
  ),
  lineStep: step(
    (raw as { lineStep?: unknown } | undefined)?.lineStep,
    LINE_STEPS.length,
    DEFAULT_TYPOGRAPHY.lineStep
  ),
});

function decode(raw: unknown): StoredRecord {
  if (typeof raw !== "object" || raw === null || !("version" in raw))
    return empty();
  const version = (raw as { version?: unknown }).version;
  if (version !== 2 && version !== 3)
    // Version 1 (pdfToolbar) and anything unrecognized migrate to the
    // defaults: the toolbar choice retired by design, the theme starts
    // following the system.
    return empty();
  const record = raw as { theme?: unknown; typography?: unknown };
  return {
    version: 3,
    theme: isThemePreference(record.theme) ? record.theme : "system",
    typography:
      version === 3
        ? decodeTypography(record.typography)
        : { ...DEFAULT_TYPOGRAPHY },
  };
}

export function createUiSettingsStore(
  storage: NamespaceStorage
): UiSettingsStore {
  const record = createNamespaceRecord<unknown>("ui-settings", empty, storage);
  return {
    async load() {
      try {
        const { theme, typography } = decode(await record.read());
        return { theme, typography };
      } catch {
        const { theme, typography } = empty();
        return { theme, typography };
      }
    },
    saveTheme(theme) {
      return record
        .update(async (raw, write) => {
          const data = decode(raw);
          await write({ ...data, theme });
        })
        .catch(() => undefined);
    },
    saveTypography(steps) {
      return record
        .update(async (raw, write) => {
          const data = decode(raw);
          await write({
            ...data,
            typography: { ...data.typography, ...steps },
          });
        })
        .catch(() => undefined);
    },
  };
}

export function createMemoryUiSettingsStore(): UiSettingsStore {
  let settings: StoredRecord = empty();
  return {
    async load() {
      const { theme, typography } = decode(structuredClone(settings));
      return { theme, typography };
    },
    async saveTheme(theme) {
      settings = { ...settings, theme };
    },
    async saveTypography(steps) {
      settings = {
        ...settings,
        typography: { ...settings.typography, ...steps },
      };
    },
  };
}
