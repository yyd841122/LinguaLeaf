import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { NOTE_TYPE_LABELS } from "../src/NotePanels";
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
const tab = (type: NoteType) =>
  screen.getByRole("tab", { name: new RegExp(`^${NOTE_TYPE_LABELS[type]}`) });
const selectPane = (type: NoteType) => {
  fireEvent.click(tab(type));
  return within(screen.getByRole("tabpanel"));
};
const selectText = (type: NoteType) => selectPane(type).getByRole("textbox");
async function clickAction(type: NoteType, name: string) {
  const button = selectPane(type).getByRole("button", { name });
  await act(async () => fireEvent.click(button));
}
afterEach(() => vi.restoreAllMocks());

it.each<{ notes: NoteSummary[]; selected: NoteType }>([
  { notes: [], selected: "progress" },
  { notes: [note("question")], selected: "question" },
  { notes: [note("question"), note("idea", 2)], selected: "idea" },
  {
    notes: [note("question"), note("idea", 2), note("feeling", 3)],
    selected: "feeling",
  },
  {
    notes: [note("question"), note("progress", 2), note("idea", 3)],
    selected: "progress",
  },
])("defaults to $selected in fixed type order", ({ notes, selected }) => {
  render(
    <NotePopup
      ref={null}
      notes={notes}
      point={{ x: 20, y: 20 }}
      onClose={vi.fn()}
      onSave={vi.fn()}
      onDelete={vi.fn()}
    />
  );
  expect(screen.getByRole("tab", { selected: true })).toBe(tab(selected));
  expect(screen.getAllByRole("textbox")).toHaveLength(1);
  expect(screen.getByRole("textbox")).toHaveAccessibleName(
    `${NOTE_TYPE_LABELS[selected]}笔记内容`
  );
  const dialog = screen.getByRole("dialog");
  expect(dialog).toHaveStyle({ width: "288px", maxHeight: "256px" });
});

it("switches clean tabs and dismisses without confirmation", () => {
  const confirm = vi.spyOn(window, "confirm");
  const close = vi.fn();
  render(
    <NotePopup
      ref={null}
      notes={[note("idea")]}
      point={{ x: 20, y: 20 }}
      onClose={close}
      onSave={vi.fn()}
      onDelete={vi.fn()}
    />
  );
  for (const type of NOTE_TYPES) selectPane(type);
  fireEvent.click(document.body);
  expect(confirm).not.toHaveBeenCalled();
  expect(close).toHaveBeenCalledOnce();
});

it("links the active tab to its only pane and supports keyboard focus navigation", () => {
  const confirm = vi.spyOn(window, "confirm");
  render(
    <NotePopup
      ref={null}
      notes={[]}
      point={{ x: 20, y: 20 }}
      onClose={vi.fn()}
      onSave={vi.fn()}
      onDelete={vi.fn()}
    />
  );
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "Draft" } });
  const checkSelected = (type: NoteType) => {
    const selected = tab(type);
    const panel = screen.getByRole("tabpanel");
    expect(selected).toHaveAttribute("aria-selected", "true");
    expect(selected).toHaveAttribute("tabindex", "0");
    expect(selected).toHaveFocus();
    expect(selected).toHaveAttribute("aria-controls", panel.id);
    expect(panel).toHaveAttribute("aria-labelledby", selected.id);
    expect(screen.getAllByRole("tabpanel")).toHaveLength(1);
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
    for (const other of NOTE_TYPES.filter((value) => value !== type)) {
      expect(tab(other)).toHaveAttribute("aria-selected", "false");
      expect(tab(other)).toHaveAttribute("tabindex", "-1");
    }
  };
  tab("progress").focus();
  fireEvent.keyDown(tab("progress"), { key: "ArrowRight" });
  checkSelected("feeling");
  fireEvent.keyDown(tab("feeling"), { key: "End" });
  checkSelected("question");
  fireEvent.keyDown(tab("question"), { key: "ArrowRight" });
  checkSelected("progress");
  expect(screen.getByRole("textbox")).toHaveValue("Draft");
  fireEvent.keyDown(tab("progress"), { key: "ArrowLeft" });
  checkSelected("question");
  fireEvent.keyDown(tab("question"), { key: "Home" });
  checkSelected("progress");
  expect(confirm).not.toHaveBeenCalled();
});

it("shows four colored tabs and confirms hidden dirty drafts on Esc/outside", async () => {
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
  expect(screen.getByRole("tablist", { name: "笔记类型" })).toBeInTheDocument();
  expect(screen.getAllByRole("tab")).toHaveLength(4);
  expect(screen.getAllByRole("textbox")).toHaveLength(1);
  expect(screen.getAllByRole("tabpanel")).toHaveLength(1);
  expect(tab("feeling")).toHaveAttribute("aria-selected", "true");
  expect(screen.getByRole("textbox")).toHaveValue("Original");
  for (const type of NOTE_TYPES) {
    expect(tab(type)).toHaveAttribute("data-note-type", type);
    expect(tab(type)).toHaveClass("note-type-title");
    expect(tab(type)).toHaveAttribute(
      "aria-selected",
      String(type === "feeling")
    );
  }
  expect(within(tab("feeling")).getByLabelText("已有笔记")).toHaveTextContent(
    "●"
  );
  expect(
    within(tab("idea")).queryByLabelText("已有笔记")
  ).not.toBeInTheDocument();
  fireEvent.change(selectText("question"), {
    target: { value: "Question draft" },
  });
  fireEvent.change(selectText("progress"), {
    target: { value: "Progress draft" },
  });
  selectPane("feeling");
  expect(confirm).not.toHaveBeenCalled();
  expect(screen.getByRole("textbox")).toHaveValue("Original");
  fireEvent.keyDown(document, { key: "Escape" });
  fireEvent.click(document.body);
  expect(confirm).toHaveBeenCalledTimes(2);
  expect(confirm).toHaveBeenCalledWith("放弃修改？");
  expect(close).not.toHaveBeenCalled();
  expect(selectText("question")).toHaveValue("Question draft");
  expect(selectText("progress")).toHaveValue("Progress draft");
  expect(confirm).toHaveBeenCalledTimes(2);
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
  fireEvent.change(selectText("idea"), { target: { value: "My draft" } });
  fireEvent.change(selectText("question"), {
    target: { value: "Unrelated draft" },
  });
  await clickAction("idea", "保存");
  expect(selectText("idea")).toHaveValue("My draft");
  expect(selectPane("idea").getByRole("alert")).toHaveTextContent("失败");
  expect(selectPane("question").queryByRole("alert")).not.toBeInTheDocument();
  expect(selectPane("idea").getByRole("alert")).toHaveTextContent("失败");
  await clickAction("idea", "保存");
  expect(save).toHaveBeenLastCalledWith(null, {
    type: "idea",
    text: "My draft",
  });
  expect(selectText("idea").closest("form")).toHaveClass("has-note");
  expect(within(tab("idea")).getByLabelText("已有笔记")).toBeInTheDocument();
  expect(
    selectPane("idea").getByRole("button", { name: "删除" })
  ).toBeEnabled();
  await clickAction("feeling", "删除");
  expect(screen.getByRole("tab", { selected: true })).toBe(tab("feeling"));
  expect(remove).toHaveBeenCalledWith(note("feeling", 2));
  expect(selectText("feeling")).toHaveValue("");
  expect(selectText("feeling").closest("form")).not.toHaveClass("has-note");
  expect(
    within(tab("feeling")).queryByLabelText("已有笔记")
  ).not.toBeInTheDocument();
  expect(selectText("question")).toHaveValue("Unrelated draft");
  expect(selectText("idea")).toHaveValue("My draft");
  fireEvent.change(selectText("idea"), { target: { value: "Edit saved" } });
  await clickAction("idea", "保存");
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
  fireEvent.change(selectText("idea"), { target: { value: "Changed" } });
  fireEvent.change(selectText("progress"), { target: { value: "Stopped" } });
  fireEvent.click(selectPane("idea").getByRole("button", { name: "保存" }));
  fireEvent.click(selectPane("idea").getByRole("button", { name: "保存中…" }));
  expect(
    selectPane("idea").getByRole("button", { name: "删除" })
  ).toBeDisabled();
  expect(
    selectPane("progress").getByRole("button", { name: "保存" })
  ).toBeEnabled();
  fireEvent.click(selectPane("progress").getByRole("button", { name: "保存" }));
  expect(save).toHaveBeenCalledTimes(2);
  await act(async () =>
    resolveIdea({ outcome: "saved", note: note("idea", 1, "Changed") })
  );
  expect(screen.getByRole("tab", { selected: true })).toBe(tab("progress"));
  expect(within(tab("idea")).getByLabelText("已有笔记")).toBeInTheDocument();
  expect(selectText("idea")).toHaveValue("Changed");
  fireEvent.keyDown(document, { key: "Escape" });
  expect(close).not.toHaveBeenCalled();
  expect(
    selectPane("progress").getByRole("button", { name: "保存中…" })
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
  fireEvent.change(selectText("idea"), { target: { value: "New draft" } });
  await clickAction("idea", "保存");
  expect(selectPane("idea").getByRole("alert")).toHaveTextContent(
    "Existing text"
  );
  expect(selectText("idea")).toHaveValue("New draft");
  expect(
    selectPane("feeling").queryByRole("button", { name: "删除" })
  ).not.toBeInTheDocument();
  await clickAction("idea", "保存");
  expect(save).toHaveBeenLastCalledWith(9, { type: "idea", text: "New draft" });
});
