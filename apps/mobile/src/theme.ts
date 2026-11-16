import { useEffect, useState } from "react";
import type {
  ThemePreference,
  UiSettingsStore,
} from "./store/ui-settings-store";

// Redesign ticket 01's manual theme mechanism. The preference (暖纸 |
// 白 | 夜间 | 跟随系统) lives in ui-settings; this module resolves it —
// system light lands on 暖纸, the default light — and stamps the result
// on <html data-theme>, the one attribute every face (shelf, EPUB, PDF,
// popups) inherits. Reader 02's Aa panel will drive the choice; the
// hook here is the whole mechanism.

export type ResolvedTheme = "paper" | "white" | "night";

export function resolveTheme(
  preference: ThemePreference,
  systemDark: boolean
): ResolvedTheme {
  if (preference === "system") return systemDark ? "night" : "paper";
  return preference;
}

export function useThemePreference(settings: UiSettingsStore): void {
  const [preference, setPreference] = useState<ThemePreference>("system");

  // One-shot read, plain cancelled flag (not the settle channel): the
  // store degrades internally — load() never rejects — so there is no
  // failure surface to adjudicate, and a remount re-reads by itself.
  useEffect(() => {
    let cancelled = false;
    settings.load().then((value) => {
      if (!cancelled) setPreference(value.theme);
    });
    return () => {
      cancelled = true;
    };
  }, [settings]);

  // Resolve and apply: while the preference follows the system, the
  // media listener keeps the attribute honest when the scheme flips
  // mid-session. Hosts without matchMedia (jsdom) resolve system as
  // light — the reading app's default face.
  useEffect(() => {
    const media =
      typeof window !== "undefined" && typeof window.matchMedia === "function"
        ? window.matchMedia("(prefers-color-scheme: dark)")
        : null;
    const apply = (dark: boolean) => {
      document.documentElement.dataset.theme = resolveTheme(preference, dark);
    };
    apply(media?.matches ?? false);
    if (preference !== "system" || !media) return;
    const onChange = () => apply(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [preference]);
}
