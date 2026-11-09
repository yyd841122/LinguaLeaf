import type { Plugin } from "vite";

// Ticket 09: the mobile speak router's browser fallback reuses the kernel's
// browser speakWord verbatim, through this virtual id. The plugin maps the
// specifier to the kernel's built speak module — the kernel itself stays
// untouched (mobile-app spec's hard boundary). The kernel popup is NOT
// redirected here: on mobile its speak button is intercepted at the
// wrapper's capture phase (apps/mobile/src/reader/WordLookupPopup.tsx),
// which needs no build pipeline at all.

// The specifier only ever appears inside the mobile router, and the plugin
// rejects every other import, so the module is reached exactly once.
export const KERNEL_SPEAK_VIRTUAL_ID = "virtual:lingualeaf-kernel-speak";

export interface KernelSpeakPaths {
  /** Absolute path of the kernel's built speak module (dist/speak.js). */
  kernelSpeakPath: string;
}

// Pure so tests can pin the mapping with injected paths — the module never
// locates itself (jsdom rewrites import.meta.url, so src modules must not
// anchor on it; the configs pass the real absolute path from Node context).
export function resolveKernelSpeak(
  source: string,
  paths: KernelSpeakPaths
): string | null {
  return source === KERNEL_SPEAK_VIRTUAL_ID ? paths.kernelSpeakPath : null;
}

export function kernelSpeakPlugin(paths: KernelSpeakPaths): Plugin {
  return {
    name: "lingualeaf-mobile:kernel-speak",
    resolveId(source) {
      return resolveKernelSpeak(source, paths);
    },
  };
}
