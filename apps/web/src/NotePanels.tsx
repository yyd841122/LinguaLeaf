import { useImperativeHandle, useRef, useState, type Ref } from "react";
import {
  NOTE_TYPES,
  type NoteContent,
  type NoteSummary,
  type NoteType,
} from "../../server/src/wire";
import type { NoteOperation } from "./notesSession";

export const NOTE_TYPE_LABELS: Record<NoteType, string> = {
  progress: "进度",
  feeling: "感受",
  idea: "思路",
  question: "疑问",
};
export type NotePanelsHandle = { requestClose: () => boolean };
export type NotePanelsProps = {
  notes: NoteSummary[];
  onSave: (id: number | null, content: NoteContent) => Promise<NoteOperation>;
  onDelete: (note: NoteSummary) => Promise<NoteOperation>;
};
type Phase = "clean" | "dirty" | "saving" | "failed" | "deleting";
type Panel = {
  existing: NoteSummary | null;
  savedText: string;
  text: string;
  phase: Phase;
  message: string | null;
};

// Shared by the anchored popup and the expanded article banner. Each type
// owns its draft and operation; settling one must leave the other three intact.
export function NotePanels({
  notes,
  onSave,
  onDelete,
  ref,
}: NotePanelsProps & {
  ref: Ref<NotePanelsHandle>;
}) {
  const [panels, setPanels] = useState(
    () =>
      Object.fromEntries(
        NOTE_TYPES.map((type) => {
          const existing = notes.find((note) => note.type === type) ?? null;
          return [
            type,
            {
              existing,
              savedText: existing?.text ?? "",
              text: existing?.text ?? "",
              phase: "clean",
              message: null,
            },
          ];
        })
      ) as Record<NoteType, Panel>
  );
  const busy = useRef(new Set<NoteType>());
  useImperativeHandle(ref, () => ({
    requestClose: () => {
      if (busy.current.size) return false;
      return (
        !NOTE_TYPES.some(
          (type) => panels[type].text !== panels[type].savedText
        ) || window.confirm("放弃修改？")
      );
    },
  }));
  const patch = (type: NoteType, value: Partial<Panel>) =>
    setPanels((current) => ({
      ...current,
      [type]: { ...current[type], ...value },
    }));
  const finish = async (type: NoteType, deleting: boolean) => {
    if (busy.current.has(type)) return;
    const panel = panels[type];
    busy.current.add(type);
    patch(type, { phase: deleting ? "deleting" : "saving", message: null });
    let result: NoteOperation;
    try {
      result = await (deleting && panel.existing
        ? onDelete(panel.existing)
        : onSave(panel.existing?.id ?? null, { type, text: panel.text }));
    } catch {
      result = { outcome: "failed" };
    }
    busy.current.delete(type);
    if (result.outcome === "saved") {
      patch(type, {
        existing: deleting ? null : (result.note ?? panel.existing),
        savedText: deleting ? "" : panel.text,
        text: deleting ? "" : panel.text,
        phase: "clean",
        message: null,
      });
    } else if (result.outcome === "conflict") {
      patch(type, {
        existing: result.note,
        savedText: result.note.text,
        phase: "failed",
        message: `此处已有笔记：${result.note.text}。草稿已保留，再次保存将替换它。`,
      });
    } else if (result.outcome === "stale") {
      // The answer belongs to a superseded session (book switched while
      // the request flew). The banner outlives chapter switches, so this
      // is reachable — drop the pane back to its editable state instead
      // of stranding it disabled; the draft survives.
      patch(type, {
        phase: panel.text === panel.savedText ? "clean" : "dirty",
      });
    } else {
      patch(type, {
        phase: "failed",
        message: deleting
          ? "删除失败，请重试。"
          : "保存失败，文本已保留，请重试。",
      });
    }
  };
  return (
    <div className="note-panels">
      {NOTE_TYPES.map((type) => {
        const panel = panels[type];
        const pending = panel.phase === "saving" || panel.phase === "deleting";
        return (
          <form
            key={type}
            className={`note-panel${panel.savedText ? " has-note" : ""}`}
            data-note-type={type}
            aria-label={`${NOTE_TYPE_LABELS[type]}笔记`}
            onSubmit={(event) => {
              event.preventDefault();
              void finish(type, false);
            }}
          >
            <fieldset disabled={pending}>
              <legend className="note-type-title" data-note-type={type}>
                {NOTE_TYPE_LABELS[type]}
                {panel.savedText && <span aria-label="已有笔记"> ●</span>}
              </legend>
              <label>
                {NOTE_TYPE_LABELS[type]}笔记内容
                <textarea
                  value={panel.text}
                  maxLength={10_000}
                  rows={3}
                  onChange={(event) =>
                    patch(type, {
                      text: event.target.value,
                      phase:
                        event.target.value === panel.savedText
                          ? "clean"
                          : "dirty",
                      message: null,
                    })
                  }
                />
              </label>
              <div className="note-actions">
                <button type="submit" disabled={!panel.text.trim()}>
                  {panel.phase === "saving" ? "保存中…" : "保存"}
                </button>
                {panel.existing && (
                  <button type="button" onClick={() => void finish(type, true)}>
                    {panel.phase === "deleting" ? "删除中…" : "删除"}
                  </button>
                )}
              </div>
            </fieldset>
            {panel.message && <p role="alert">{panel.message}</p>}
          </form>
        );
      })}
    </div>
  );
}
