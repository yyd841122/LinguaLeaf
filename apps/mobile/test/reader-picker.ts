// The reader picker's accessible name, written once: six test files query
// the picker by this label, and one rename was a 13-site mechanical sweep
// (真机 md round 2; .scratch/test-picker-label-constant/). Rename it here
// and fix what the compiler flags — the import list is the site list.
export const PICKER_LABEL = "选择 EPUB、PDF 或 Markdown 文件";

// Redesign 02: the reading face's controls live behind the summonable
// menu — a background tap (a click on the reading surface itself, never
// a word or control) summons the bars. Written once: every suite that
// drives the face's controls opens with this.
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { expect } from "vitest";

export async function summonMenu(): Promise<void> {
  // Idempotent: a click that CLOSED the note editor passes straight
  // through to the surface and opens the menu on its own (the editor's
  // capture guard only swallows taps while a draft is protected) — a
  // second blind click would toggle it shut again.
  if (document.querySelector(".reader-menu-top")) return;
  const face = document.querySelector("main.reader:not(.reader-entry)");
  if (!face) throw new Error("reading face not mounted");
  fireEvent.click(face);
  await screen.findByRole("group", { name: "阅读菜单顶栏" });
}

// Dismiss the bars when a step needs the hidden state (the edge strips
// only exist while the menu is closed).
export async function dismissMenu(): Promise<void> {
  if (!document.querySelector(".reader-menu-top")) return;
  const face = document.querySelector("main.reader:not(.reader-entry)");
  if (!face) throw new Error("reading face not mounted");
  fireEvent.click(face);
  await waitFor(() =>
    expect(document.querySelector(".reader-menu-top")).toBeNull()
  );
}
