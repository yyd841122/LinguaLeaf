import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { createRef } from "react";
import type { NoteType } from "../../server/src/wire";
import { NoteEditor, type NoteEditorHandle } from "../src/reader/NoteEditor";
import { POPUP_MAX_HEIGHT_PX } from "@lingualeaf/reading-model";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
type Note = { type: NoteType; text: string };
function mount(save: (type: NoteType, text: string) => Promise<Note>) {
  const button = document.createElement("button");
  document.body.append(button);
  const onCommitted = vi.fn();
  const onClose = vi.fn();
  const ref = createRef<NoteEditorHandle>();
  const view = render(
    <NoteEditor
      ref={ref}
      ownerKey="one"
      ariaLabel="笔记"
      initial={[]}
      button={button}
      store={{ save, delete: vi.fn() }}
      onCommitted={onCommitted}
      onClose={onClose}
    />
  );
  return { ...view, button, ref, onCommitted, onClose };
}
const tab = (name: string) =>
  fireEvent.click(screen.getByRole("tab", { name }));
const draft = (value: string) =>
  fireEvent.change(screen.getByRole("textbox"), { target: { value } });
const submit = () =>
  fireEvent.click(screen.getByRole("button", { name: "保存" }));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it.each([false, true])(
  "isolates per-type busy and late feedback (reject=%s)",
  async (reject) => {
    const pending = deferred<Note>();
    const save = vi.fn((type: NoteType, text: string) =>
      type === "progress" ? pending.promise : Promise.resolve({ type, text })
    );
    const ctx = mount(save);
    draft("progress draft");
    submit();
    expect(screen.getByRole("textbox")).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "处理中…" }));
    expect(save).toHaveBeenCalledTimes(1);
    tab("感受");
    expect(screen.getByRole("textbox")).toBeEnabled();
    draft("feeling draft");
    submit();
    expect(await screen.findByRole("status")).toHaveTextContent("已存");
    tab("进度");
    expect(screen.getByRole("textbox")).toBeDisabled();
    await act(async () => {
      if (reject) pending.reject(new Error("quota"));
      else pending.resolve({ type: "progress", text: "progress draft" });
    });
    expect(screen.getByRole("textbox")).toHaveValue("progress draft");
    expect(screen.getByRole("textbox")).toBeEnabled();
    if (reject)
      expect(screen.getByRole("alert")).toHaveTextContent("草稿已保留");
    else expect(screen.getByRole("status")).toHaveTextContent("已存");
    tab("感受");
    expect(screen.getByRole("textbox")).toHaveValue("feeling draft");
    expect(screen.getByRole("status")).toHaveTextContent("已存");
    expect(ctx.onCommitted).toHaveBeenCalledWith("feeling", {
      type: "feeling",
      text: "feeling draft",
    });
    ctx.button.remove();
  }
);

it("a different type's success leaves an existing failure and its draft intact", async () => {
  const save = vi.fn(async (type: NoteType, text: string) => {
    if (type === "progress") throw new Error("quota");
    return { type, text };
  });
  const ctx = mount(save);
  draft("failed progress");
  submit();
  expect(await screen.findByRole("alert")).toHaveTextContent("草稿已保留");
  tab("思路");
  draft("saved idea");
  submit();
  expect(await screen.findByRole("status")).toHaveTextContent("已存");
  tab("进度");
  expect(screen.getByRole("alert")).toHaveTextContent("草稿已保留");
  expect(screen.getByRole("textbox")).toHaveValue("failed progress");
  expect(screen.queryByRole("status")).toBeNull();
  ctx.button.remove();
});

it.each(["进度", "感受", "思路", "疑问"])(
  "counts an inactive %s draft in dirty-close confirmation",
  (label) => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const ctx = mount(async (type, text) => ({ type, text }));
    tab(label);
    draft(`${label} draft`);
    tab(label === "进度" ? "疑问" : "进度");
    expect(screen.getByRole("textbox")).toHaveValue("");
    expect(ctx.ref.current?.requestClose()).toBe(false);
    expect(confirm).toHaveBeenCalledExactlyOnceWith("放弃修改？");
    expect(ctx.onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(ctx.onClose).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(ctx.onClose).toHaveBeenCalledTimes(1);
    expect(ctx.button).toHaveFocus();
    ctx.button.remove();
  }
);

it("keeps tab keyboard focus, one visible field and viewport height limits at a narrow window", () => {
  vi.stubGlobal("innerWidth", 240);
  vi.stubGlobal("innerHeight", 220);
  const ctx = mount(async (type, text) => ({ type, text }));
  expect(screen.getByRole("textbox")).toHaveFocus();
  const dialog = screen.getByRole("dialog");
  expect(dialog.style.maxHeight).toBe("204px");
  expect(dialog.style.left).toBe("8px");
  const progress = screen.getByRole("tab", { name: "进度" });
  progress.focus();
  fireEvent.keyDown(progress, { key: "End" });
  const question = screen.getByRole("tab", { name: "疑问" });
  expect(question).toHaveFocus();
  expect(question).toHaveAttribute("aria-selected", "true");
  expect(screen.getByRole("tabpanel", { name: "疑问" })).toHaveAttribute(
    "id",
    question.getAttribute("aria-controls")
  );
  expect(screen.getAllByRole("textbox")).toHaveLength(1);
  draft("question draft");
  fireEvent.keyDown(question, { key: "ArrowRight" });
  expect(progress).toHaveFocus();
  fireEvent.keyDown(progress, { key: "ArrowLeft" });
  expect(question).toHaveFocus();
  expect(screen.getByRole("textbox")).toHaveValue("question draft");
  fireEvent.keyDown(question, { key: "Home" });
  expect(progress).toHaveFocus();
  ctx.button.remove();
});

// The keyboard belt (ticket 06): an IME that overlays without resizing
// leaves the fixed box under it — the visual viewport's own bounds lift
// the box into what stays visible. The anchor button rides LOW (its
// rect pinned near the layout bottom), so an unclamped box would sit
// far below the visual viewport's keyboard-shrunk bottom.
it("lifts the editor inside the visual viewport when the keyboard overlays", async () => {
  const listeners = new Map<string, Set<() => void>>();
  const kinds = () => [...listeners.keys()].sort();
  const viewport = {
    offsetTop: 0,
    height: 350, // the keyboard left 350 of the 800px layout visible
    addEventListener: (kind: string, fn: () => void) => {
      listeners.set(kind, (listeners.get(kind) ?? new Set()).add(fn));
    },
    removeEventListener: (kind: string, fn: () => void) => {
      listeners.get(kind)?.delete(fn);
    },
  };
  vi.stubGlobal("visualViewport", viewport as unknown as VisualViewport);
  const button = document.createElement("button");
  button.getBoundingClientRect = () =>
    ({
      top: 680,
      bottom: 700,
      left: 40,
      right: 120,
      width: 80,
      height: 20,
      x: 40,
      y: 680,
      toJSON: () => ({}),
    }) as DOMRect;
  document.body.append(button);
  const view = render(
    <NoteEditor
      ref={createRef()}
      ownerKey="vv"
      ariaLabel="笔记"
      initial={[]}
      button={button}
      store={{ save: vi.fn(), delete: vi.fn() }}
      onCommitted={vi.fn()}
      onClose={vi.fn()}
    />
  );
  const box = screen.getByRole("dialog", { name: "笔记" });
  // Unclamped, the anchor puts the box at ~714px — deep under the IME.
  // The belt caps it inside the 350px visual viewport.
  const top = parseFloat(box.style.top);
  const maxHeight = parseFloat(box.style.maxHeight);
  expect(maxHeight).toBe(POPUP_MAX_HEIGHT_PX);
  expect(top).toBeLessThanOrEqual(350 - maxHeight - 8 + 1);
  expect(top).toBeLessThan(300);

  // The keyboard closes: the listener-driven re-read frees the belt and
  // the box returns toward the (still-low) anchor.
  // Both listener kinds are wired (the belt must track pan too, not
  // just resize).
  expect(kinds()).toEqual(["resize", "scroll"]);
  viewport.offsetTop = 0;
  viewport.height = 800;
  act(() => {
    for (const fns of listeners.values()) for (const fn of fns) fn();
  });
  const freed = await screen.findByRole("dialog", { name: "笔记" });
  expect(parseFloat(freed.style.top)).toBeGreaterThan(300);
  view.unmount();
  button.remove();
});

// The clamp's LOWER bound (the review's probe): a keyboard-pinched
// visual viewport pushed DOWN (offsetTop 100) with a high anchor — the
// box must not sit above the visible band's top edge.
it("lifts the editor below the visual viewport's pushed-down top", async () => {
  const listeners = new Set<() => void>();
  const viewport = {
    offsetTop: 100,
    height: 350,
    addEventListener: (_kind: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_kind: string, fn: () => void) =>
      listeners.delete(fn),
  };
  vi.stubGlobal("visualViewport", viewport as unknown as VisualViewport);
  const button = document.createElement("button");
  button.getBoundingClientRect = () =>
    ({
      top: 10,
      bottom: 34,
      left: 40,
      right: 120,
      width: 80,
      height: 24,
      x: 40,
      y: 10,
      toJSON: () => ({}),
    }) as DOMRect;
  document.body.append(button);
  const view = render(
    <NoteEditor
      ref={createRef()}
      ownerKey="vv-low"
      ariaLabel="笔记"
      initial={[]}
      button={button}
      store={{ save: vi.fn(), delete: vi.fn() }}
      onCommitted={vi.fn()}
      onClose={vi.fn()}
    />
  );
  const box = screen.getByRole("dialog", { name: "笔记" });
  // Unclamped anchor math lands at ~48; the band starts at 100.
  const top = parseFloat(box.style.top);
  expect(top).toBeGreaterThanOrEqual(100 + 8 - 1);
  expect(top).toBeLessThanOrEqual(100 + 8 + 1);
  view.unmount();
  button.remove();
});
