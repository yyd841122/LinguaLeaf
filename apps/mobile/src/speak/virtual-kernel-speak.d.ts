// The kernel speak module, reached only through the speak-redirect
// resolver's virtual id (apps/mobile/src/speak/speak-redirect.ts). The
// declaration mirrors the kernel's own speak.ts signature; the Vite plugin
// maps the specifier to packages/reading-model/dist/speak.js at resolve
// time, so no real module of this name exists on disk.
declare module "virtual:lingualeaf-kernel-speak" {
  export function speakWord(word: string): void;
}
