import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { NotePopup } from "../src/NotePopup";

afterEach(() => vi.restoreAllMocks());
it("confirms dirty Esc/outside dismissal, preserves a failed draft, and retries", async () => {
  const close = vi.fn();
  const save = vi
    .fn()
    .mockResolvedValueOnce({ outcome: "failed" })
    .mockResolvedValueOnce({ outcome: "saved" });
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  render(
    <NotePopup
      ref={null}
      note={null}
      point={{ x: 20, y: 20 }}
      onClose={close}
      onSave={save}
      onDelete={vi.fn()}
    />
  );
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "My draft" },
  });
  fireEvent.keyDown(document, { key: "Escape" });
  expect(confirm).toHaveBeenCalledWith("放弃修改？");
  expect(close).not.toHaveBeenCalled();
  fireEvent.click(document.body);
  expect(confirm).toHaveBeenCalledTimes(2);
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "保存" }))
  );
  expect(screen.getByRole("textbox")).toHaveValue("My draft");
  expect(screen.getByRole("alert")).toHaveTextContent("失败");
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "保存" }))
  );
  expect(save).toHaveBeenCalledTimes(2);
  expect(close).toHaveBeenCalledTimes(1);
});

it("serializes save/delete/close while a save is pending", async () => {
  let resolve!: (value: { outcome: "saved" }) => void;
  const save = vi.fn(
    () =>
      new Promise<{ outcome: "saved" }>((r) => {
        resolve = r;
      })
  );
  const close = vi.fn();
  render(
    <NotePopup
      ref={null}
      note={{
        id: 1,
        chapter: 1,
        block: 1,
        type: "idea",
        text: "Original",
        createdAt: "now",
        updatedAt: "now",
      }}
      point={{ x: 0, y: 0 }}
      onClose={close}
      onSave={save}
      onDelete={vi.fn()}
    />
  );
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "Changed" },
  });
  fireEvent.click(screen.getByRole("button", { name: "保存" }));
  expect(screen.getByRole("button", { name: "保存中…" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "删除" })).toBeDisabled();
  fireEvent.keyDown(document, { key: "Escape" });
  expect(close).not.toHaveBeenCalled();
  await act(async () => resolve({ outcome: "saved" }));
  expect(close).toHaveBeenCalledTimes(1);
});

it("keeps a duplicate-create draft and uses the existing id for an explicit replacement", async () => {
  const existing = {
    id: 9,
    chapter: 1,
    block: 1,
    type: "idea" as const,
    text: "Existing text",
    createdAt: "now",
    updatedAt: "now",
  };
  const save = vi
    .fn()
    .mockResolvedValueOnce({ outcome: "conflict", note: existing })
    .mockResolvedValueOnce({ outcome: "saved" });
  render(
    <NotePopup
      ref={null}
      note={null}
      point={{ x: 0, y: 0 }}
      onClose={vi.fn()}
      onSave={save}
      onDelete={vi.fn()}
    />
  );
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "New draft" },
  });
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "保存" }))
  );
  expect(screen.getByRole("alert")).toHaveTextContent("Existing text");
  expect(screen.getByRole("textbox")).toHaveValue("New draft");
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "保存" }))
  );
  expect(save).toHaveBeenLastCalledWith(9, { type: "idea", text: "New draft" });
});
