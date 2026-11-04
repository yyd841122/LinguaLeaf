import {
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
} from "react";
import {
  anchorPopup,
  POPUP_WIDTH_PX,
  POPUP_MAX_HEIGHT_PX,
  type ClickPoint,
} from "@lingualeaf/reading-model";
import type { NoteContent, NoteSummary, NoteType } from "../../server/src/wire";
import type { NoteOperation } from "./notesSession";

export const NOTE_TYPE_LABELS: Record<NoteType, string> = {
  progress: "进度",
  feeling: "感受",
  idea: "思路",
  question: "疑问",
};
export type NotePopupHandle = { requestClose: () => boolean };
type Phase = "clean" | "dirty" | "saving" | "failed" | "deleting";

export function NotePopup({
  note,
  point,
  onClose,
  onSave,
  onDelete,
  ref,
}: {
  note: NoteSummary | null;
  point: ClickPoint;
  onClose: () => void;
  onSave: (id: number | null, content: NoteContent) => Promise<NoteOperation>;
  onDelete: (note: NoteSummary) => Promise<NoteOperation>;
  ref: Ref<NotePopupHandle>;
}) {
  const [existing, setExisting] = useState(note);
  const [type, setType] = useState<NoteType>(note?.type ?? "idea");
  const [text, setText] = useState(note?.text ?? "");
  const [phase, setPhase] = useState<Phase>("clean");
  const [message, setMessage] = useState<string | null>(null);
  const container = useRef<HTMLDivElement>(null);
  const busy = useRef(false);
  const closed = useRef(false);
  const dirty =
    text !== (existing?.text ?? "") || type !== (existing?.type ?? "idea");
  const requestClose = () => {
    if (closed.current) return true;
    if (busy.current) return false;
    if (dirty && !window.confirm("放弃修改？")) return false;
    closed.current = true;
    onClose();
    return true;
  };
  useImperativeHandle(ref, () => ({ requestClose }));
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (
        event.target instanceof Node &&
        !container.current?.contains(event.target)
      ) {
        if (!requestClose()) {
          event.preventDefault();
          event.stopPropagation();
        }
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        requestClose();
      }
    };
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKey, true);
    };
  });
  const finish = async (deleting: boolean) => {
    if (busy.current) return;
    busy.current = true;
    setPhase(deleting ? "deleting" : "saving");
    setMessage(null);
    let result: NoteOperation;
    try {
      result = await (deleting && existing
        ? onDelete(existing)
        : onSave(existing?.id ?? null, { type, text }));
    } catch {
      result = { outcome: "failed" };
    }
    busy.current = false;
    if (result.outcome === "saved") {
      closed.current = true;
      onClose();
      return;
    }
    if (result.outcome === "stale") return;
    setPhase("failed");
    if (result.outcome === "conflict") {
      // Preserve the draft while turning subsequent saves into PUTs. The
      // reader sees the existing text before explicitly replacing it.
      setExisting(result.note);
      setMessage(
        `此处已有笔记：${result.note.text}。草稿已保留，再次保存将替换它。`
      );
    } else {
      setMessage(
        deleting ? "删除失败，请重试。" : "保存失败，文本已保留，请重试。"
      );
    }
  };
  const position = anchorPopup(point, {
    width: window.innerWidth,
    height: window.innerHeight,
  });
  const pending = phase === "saving" || phase === "deleting";
  return (
    <div
      ref={container}
      className="note-popup"
      role="dialog"
      aria-label="笔记"
      style={{
        ...position,
        width: POPUP_WIDTH_PX,
        maxHeight: POPUP_MAX_HEIGHT_PX,
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void finish(false);
        }}
      >
        <fieldset disabled={pending}>
          <legend>笔记类型</legend>
          <div className="note-types">
            {(Object.keys(NOTE_TYPE_LABELS) as NoteType[]).map((value) => (
              <button
                type="button"
                key={value}
                aria-pressed={type === value}
                onClick={() => {
                  setType(value);
                  setPhase(
                    value === (existing?.type ?? "idea") &&
                      text === (existing?.text ?? "")
                      ? "clean"
                      : "dirty"
                  );
                  setMessage(null);
                }}
              >
                {NOTE_TYPE_LABELS[value]}
              </button>
            ))}
          </div>
          <label>
            笔记内容
            <textarea
              autoFocus
              value={text}
              maxLength={10_000}
              rows={4}
              onChange={(event) => {
                setText(event.target.value);
                setPhase(
                  event.target.value === (existing?.text ?? "") &&
                    type === (existing?.type ?? "idea")
                    ? "clean"
                    : "dirty"
                );
                setMessage(null);
              }}
            />
          </label>
        </fieldset>
        {message && <p role="alert">{message}</p>}
        <div className="note-actions">
          <button type="submit" disabled={pending || !text.trim()}>
            {phase === "saving" ? "保存中…" : "保存"}
          </button>
          {existing && (
            <button
              type="button"
              disabled={pending}
              onClick={() => void finish(true)}
            >
              {phase === "deleting" ? "删除中…" : "删除"}
            </button>
          )}
          <button type="button" disabled={pending} onClick={requestClose}>
            关闭
          </button>
        </div>
      </form>
    </div>
  );
}
