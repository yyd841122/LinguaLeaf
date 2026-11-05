import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { NotePopup } from "../src/NotePopup";
import {
  NOTE_TYPES,
  type NoteSummary,
  type NoteType,
} from "../../server/src/wire";

const note = (type: NoteType, id = 1, text = "Original"): NoteSummary => ({
  id,
  chapter: 1,
  block: 1,
  type,
  text,
  createdAt: "now",
  updatedAt: "now",
});
const pane = (type: NoteType) =>
  within(
    screen.getAllByRole("textbox")[NOTE_TYPES.indexOf(type)]!.closest("form")!
  );
const text = (type: NoteType) => pane(type).getByRole("textbox");
afterEach(() => vi.restoreAllMocks());

it("shows four colored partitions, highlights persisted content, and confirms any dirty partition on Esc/outside", async () => {
  const close = vi.fn();
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  render(
    <NotePopup
      ref={null}
      notes={[note("feeling")]}
      point={{ x: 20, y: 20 }}
      onClose={close}
      onSave={vi.fn()}
      onDelete={vi.fn()}
    />
  );
  expect(screen.getAllByRole("textbox")).toHaveLength(4);
  for (const type of NOTE_TYPES) {
    expect(pane(type).getByRole("textbox").closest("form")).toHaveAttribute(
      "data-note-type",
      type
    );
    expect(
      pane(type).getByRole("group").querySelector("legend")
    ).toHaveAttribute("data-note-type", type);
  }
  expect(text("feeling")).toHaveValue("Original");
  expect(pane("feeling").getByLabelText("已有笔记")).toBeInTheDocument();
  expect(text("idea").closest("form")).not.toHaveClass("has-note");
  fireEvent.change(text("question"), { target: { value: "Question draft" } });
  fireEvent.change(text("progress"), { target: { value: "Progress draft" } });
  fireEvent.keyDown(document, { key: "Escape" });
  fireEvent.click(document.body);
  expect(confirm).toHaveBeenCalledTimes(2);
  expect(confirm).toHaveBeenCalledWith("放弃修改？");
  expect(close).not.toHaveBeenCalled();
  confirm.mockReturnValue(true);
  fireEvent.keyDown(document, { key: "Escape" });
  expect(close).toHaveBeenCalledOnce();
});

it("preserves failed drafts and sibling drafts through retry and independent deletion", async () => {
  const close = vi.fn();
  const save = vi
    .fn()
    .mockResolvedValue({
      outcome: "saved",
      note: note("idea", 9, "Edit saved"),
    })
    .mockResolvedValueOnce({ outcome: "failed" })
    .mockResolvedValueOnce({
      outcome: "saved",
      note: note("idea", 9, "My draft"),
    });
  const remove = vi.fn().mockResolvedValue({ outcome: "saved" });
  render(
    <NotePopup
      ref={null}
      notes={[note("feeling", 2)]}
      point={{ x: 20, y: 20 }}
      onClose={close}
      onSave={save}
      onDelete={remove}
    />
  );
  fireEvent.change(text("idea"), { target: { value: "My draft" } });
  fireEvent.change(text("question"), { target: { value: "Unrelated draft" } });
  await act(async () =>
    fireEvent.click(pane("idea").getByRole("button", { name: "保存" }))
  );
  expect(text("idea")).toHaveValue("My draft");
  expect(pane("idea").getByRole("alert")).toHaveTextContent("失败");
  expect(pane("question").queryByRole("alert")).not.toBeInTheDocument();
  await act(async () =>
    fireEvent.click(pane("idea").getByRole("button", { name: "保存" }))
  );
  expect(save).toHaveBeenLastCalledWith(null, {
    type: "idea",
    text: "My draft",
  });
  expect(text("idea").closest("form")).toHaveClass("has-note");
  expect(pane("idea").getByRole("button", { name: "删除" })).toBeEnabled();
  await act(async () =>
    fireEvent.click(pane("feeling").getByRole("button", { name: "删除" }))
  );
  expect(remove).toHaveBeenCalledWith(note("feeling", 2));
  expect(text("feeling")).toHaveValue("");
  expect(text("feeling").closest("form")).not.toHaveClass("has-note");
  expect(text("question")).toHaveValue("Unrelated draft");
  expect(text("idea")).toHaveValue("My draft");
  fireEvent.change(text("idea"), { target: { value: "Edit saved" } });
  await act(async () =>
    fireEvent.click(pane("idea").getByRole("button", { name: "保存" }))
  );
  expect(save).toHaveBeenLastCalledWith(9, {
    type: "idea",
    text: "Edit saved",
  });
  expect(close).not.toHaveBeenCalled();
});

it("serializes operations per partition while other types can save, and blocks dismissal until all settle", async () => {
  let resolveIdea!: (value: { outcome: "saved"; note: NoteSummary }) => void;
  let resolveProgress!: (value: {
    outcome: "saved";
    note: NoteSummary;
  }) => void;
  const save = vi.fn(
    (_id, content) =>
      new Promise<{ outcome: "saved"; note: NoteSummary }>((resolve) => {
        if (content.type === "idea") resolveIdea = resolve;
        else resolveProgress = resolve;
      })
  );
  const close = vi.fn();
  render(
    <NotePopup
      ref={null}
      notes={[note("idea")]}
      point={{ x: 0, y: 0 }}
      onClose={close}
      onSave={save}
      onDelete={vi.fn()}
    />
  );
  fireEvent.change(text("idea"), { target: { value: "Changed" } });
  fireEvent.change(text("progress"), { target: { value: "Stopped" } });
  fireEvent.click(pane("idea").getByRole("button", { name: "保存" }));
  fireEvent.click(pane("idea").getByRole("button", { name: "保存中…" }));
  expect(pane("idea").getByRole("button", { name: "删除" })).toBeDisabled();
  expect(pane("progress").getByRole("button", { name: "保存" })).toBeEnabled();
  fireEvent.click(pane("progress").getByRole("button", { name: "保存" }));
  expect(save).toHaveBeenCalledTimes(2);
  await act(async () =>
    resolveIdea({ outcome: "saved", note: note("idea", 1, "Changed") })
  );
  fireEvent.keyDown(document, { key: "Escape" });
  expect(close).not.toHaveBeenCalled();
  expect(
    pane("progress").getByRole("button", { name: "保存中…" })
  ).toBeDisabled();
  await act(async () =>
    resolveProgress({ outcome: "saved", note: note("progress", 2, "Stopped") })
  );
  fireEvent.keyDown(document, { key: "Escape" });
  expect(close).toHaveBeenCalledOnce();
});

it("turns only the conflicted partition into explicit PUT editing and preserves its draft", async () => {
  const existing = note("idea", 9, "Existing text");
  const save = vi
    .fn()
    .mockResolvedValueOnce({ outcome: "conflict", note: existing })
    .mockResolvedValueOnce({
      outcome: "saved",
      note: { ...existing, text: "New draft" },
    });
  render(
    <NotePopup
      ref={null}
      notes={[]}
      point={{ x: 0, y: 0 }}
      onClose={vi.fn()}
      onSave={save}
      onDelete={vi.fn()}
    />
  );
  fireEvent.change(text("idea"), { target: { value: "New draft" } });
  await act(async () =>
    fireEvent.click(pane("idea").getByRole("button", { name: "保存" }))
  );
  expect(pane("idea").getByRole("alert")).toHaveTextContent("Existing text");
  expect(text("idea")).toHaveValue("New draft");
  expect(
    pane("feeling").queryByRole("button", { name: "删除" })
  ).not.toBeInTheDocument();
  await act(async () =>
    fireEvent.click(pane("idea").getByRole("button", { name: "保存" }))
  );
  expect(save).toHaveBeenLastCalledWith(9, { type: "idea", text: "New draft" });
});
