import { renderHook } from "@testing-library/react";
import { act, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryUiSettingsStore } from "../src/store/ui-settings-store";
import { resolveTheme, useThemePreference } from "../src/theme";

// Redesign ticket 01: the manual theme mechanism. The preference
// (暖纸 | 白 | 夜间 | 跟随系统) persists in ui-settings; the app resolves
// it (system light → 暖纸, the default light) and stamps the result on
// <html data-theme> — one attribute every face (shelf, EPUB, PDF,
// popups) inherits. jsdom ships no matchMedia, so the system seams
// install a controllable stub.

type MediaState = { matches: boolean; listeners: Set<() => void> };

const installMatchMedia = (dark: boolean) => {
  const state: MediaState = { matches: dark, listeners: new Set() };
  const media = {
    matches: state.matches,
    addEventListener: (_: string, listener: () => void) =>
      state.listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) =>
      state.listeners.delete(listener),
  };
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => {
      if (query !== "(prefers-color-scheme: dark)")
        throw new Error(`unexpected media query: ${query}`);
      return media;
    })
  );
  return {
    flip: (next: boolean) => {
      media.matches = next;
      for (const listener of state.listeners) listener();
    },
  };
};

const themeOf = () => document.documentElement.dataset.theme;

afterEach(() => {
  delete document.documentElement.dataset.theme;
  vi.unstubAllGlobals();
});

describe("resolveTheme", () => {
  it("pinned preferences pass through; system resolves against the scheme", () => {
    expect(resolveTheme("paper", true)).toBe("paper");
    expect(resolveTheme("paper", false)).toBe("paper");
    expect(resolveTheme("white", true)).toBe("white");
    expect(resolveTheme("white", false)).toBe("white");
    expect(resolveTheme("night", true)).toBe("night");
    expect(resolveTheme("night", false)).toBe("night");
    // 暖纸为默认亮色: system light lands on warm paper, not white.
    expect(resolveTheme("system", false)).toBe("paper");
    expect(resolveTheme("system", true)).toBe("night");
  });
});

describe("useThemePreference", () => {
  it("applies the stored preference to <html data-theme>", async () => {
    const settings = createMemoryUiSettingsStore();
    await settings.saveTheme("night");
    const { unmount } = renderHook(() => useThemePreference(settings));
    await waitFor(() => expect(themeOf()).toBe("night"));
    unmount();
  });

  it("follows the system while the preference is 跟随系统; the Aa panel's save pins it live (stops following)", async () => {
    const media = installMatchMedia(true);
    const settings = createMemoryUiSettingsStore();
    const { result, unmount } = renderHook(() => useThemePreference(settings));
    await waitFor(() => expect(themeOf()).toBe("night"));
    // The Aa panel (ticket 02) drives the choice through the hook's own
    // save — no remount: the pin applies immediately and stops the
    // system follow.
    act(() => result.current.save("paper"));
    await waitFor(() => expect(themeOf()).toBe("paper"));
    await waitFor(() =>
      expect(settings.load()).resolves.toMatchObject({ theme: "paper" })
    );
    // Pinned means pinned: a later system flip must NOT move the theme
    // (the probe for the mutant "pinned preference keeps following").
    act(() => media.flip(true));
    expect(themeOf()).toBe("paper");
    unmount();
  });

  it("re-resolves when the system scheme flips under 跟随系统", async () => {
    const media = installMatchMedia(false);
    const settings = createMemoryUiSettingsStore();
    const { unmount } = renderHook(() => useThemePreference(settings));
    await waitFor(() => expect(themeOf()).toBe("paper"));
    act(() => media.flip(true));
    await waitFor(() => expect(themeOf()).toBe("night"));
    act(() => media.flip(false));
    await waitFor(() => expect(themeOf()).toBe("paper"));
    unmount();
  });

  it("survives a host without matchMedia (resolves system as light)", async () => {
    const settings = createMemoryUiSettingsStore();
    const { unmount } = renderHook(() => useThemePreference(settings));
    await waitFor(() => expect(themeOf()).toBe("paper"));
    unmount();
  });
});
