import { NOTE_TYPES, type NoteType } from "../../../server/src/wire";
import {
  anchorPopup,
  POPUP_MAX_HEIGHT_PX,
  POPUP_WIDTH_PX,
} from "@lingualeaf/reading-model";
import { useOwner, useSettle } from "@lingualeaf/reading-model/react";
import {
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
} from "react";
import { NOTE_TEXT_LIMIT } from "../store/notes-store";

export type NoteEditorHandle = { requestClose(): boolean };

const NOTE_TYPE_LABELS: Record<NoteType, string> = {
  progress: "进度",
  feeling: "感受",
  idea: "思路",
  question: "疑问",
};
type Panel = {
  text: string;
  saved: string;
  exists: boolean;
  busy: boolean;
  didSave: boolean;
};

// Remounted for every opening. Each type owns its draft and settle channel;
// the shared owner revokes all editor feedback when this opening closes.
export function NoteEditor<T extends { type: NoteType; text: string }>({
  ownerKey,
  ariaLabel,
  initial,
  button,
  store,
  onCommitted,
  onClose,
  ref,
}: {
  ownerKey: string;
  ariaLabel: string;
  initial: T[];
  button: HTMLButtonElement;
  store: {
    save(type: NoteType, text: string): Promise<T>;
    delete(type: NoteType): Promise<void>;
  };
  onCommitted: (type: NoteType, note: T | null) => void;
  onClose: () => void;
  ref: Ref<NoteEditorHandle>;
}) {
  const id = useId();
  const [selectedType, setSelectedType] = useState<NoteType>(
    () =>
      NOTE_TYPES.find((type) => initial.some((note) => note.type === type)) ??
      "progress"
  );
  const [panels, setPanels] = useState(() => {
    const panel = (type: NoteType): Panel => {
      const note = initial.find((entry) => entry.type === type);
      return {
        text: note?.text ?? "",
        saved: note?.text ?? "",
        exists: !!note,
        busy: false,
        didSave: false,
      };
    };
    return {
      progress: panel("progress"),
      feeling: panel("feeling"),
      idea: panel("idea"),
      question: panel("question"),
    };
  });
  const patch = (type: NoteType, value: Partial<Panel>) =>
    setPanels((current) => ({
      ...current,
      [type]: { ...current[type], ...value },
    }));
  const { text, saved, exists, busy, didSave } = panels[selectedType];
  const busyRef = useRef(new Set<NoteType>());
  const closed = useRef(false);
  const box = useRef<HTMLDivElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const owner = useOwner(ownerKey);
  const operations = {
    progress: useSettle(owner),
    feeling: useSettle(owner),
    idea: useSettle(owner),
    question: useSettle(owner),
  };
  const operation = operations[selectedType];
  const dirty = NOTE_TYPES.some(
    (type) => panels[type].text !== panels[type].saved
  );
  const requestClose = () => {
    if (closed.current) return true;
    if (dirty && !window.confirm("放弃修改？")) return false;
    closed.current = true;
    owner.invalidate();
    onClose();
    button.focus();
    return true;
  };
  useImperativeHandle(ref, () => ({ requestClose }));

  useEffect(() => {
    textarea.current?.focus();
    return () => owner.invalidate();
  }, [owner]);

  const [point, setPoint] = useState(() => {
    const rect = button.getBoundingClientRect();
    return { x: rect.left, y: rect.bottom };
  });
  useEffect(() => {
    const position = () => {
      const rect = button.getBoundingClientRect();
      setPoint({ x: rect.left, y: rect.bottom });
    };
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    return () => {
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
    };
  }, [button]);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (
        event.target instanceof Node &&
        !box.current?.contains(event.target) &&
        !button.contains(event.target)
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

  const write = async (remove: boolean) => {
    const type = selectedType;
    if (busyRef.current.has(type)) return;
    busyRef.current.add(type);
    patch(type, { busy: true, didSave: false });
    const submitted = text;
    const result = await operation.run(
      remove
        ? store.delete(type).then(() => null)
        : store.save(type, submitted),
      {
        // A write belongs to storage even if the editor has closed. Only
        // the host's own owner may update its markers; drafts stay local.
        onLanded: (note) => onCommitted(type, note),
        onFresh: (note) => {
          patch(type, {
            exists: note !== null,
            saved: note?.text ?? "",
            text: note?.text ?? "",
            didSave: true,
          });
        },
      }
    );
    if (result.fresh) {
      busyRef.current.delete(type);
      patch(type, { busy: false });
    }
  };
  const position = anchorPopup(point, {
    width: window.innerWidth,
    height: window.innerHeight,
  });
  return (
    <div
      className="note-popup"
      role="dialog"
      aria-label={ariaLabel}
      ref={box}
      style={{
        ...position,
        width: POPUP_WIDTH_PX,
        maxHeight: Math.min(POPUP_MAX_HEIGHT_PX, window.innerHeight - 16),
      }}
    >
      <div className="note-tabs" role="tablist" aria-label="笔记类型">
        {NOTE_TYPES.map((type, index) => (
          <button
            key={type}
            type="button"
            role="tab"
            id={`${id}-tab-${type}`}
            aria-controls={`${id}-panel-${type}`}
            aria-selected={selectedType === type}
            tabIndex={selectedType === type ? 0 : -1}
            onClick={() => setSelectedType(type)}
            onKeyDown={(event) => {
              let next: number;
              switch (event.key) {
                case "ArrowRight":
                  next = (index + 1) % NOTE_TYPES.length;
                  break;
                case "ArrowLeft":
                  next = (index + NOTE_TYPES.length - 1) % NOTE_TYPES.length;
                  break;
                case "Home":
                  next = 0;
                  break;
                case "End":
                  next = NOTE_TYPES.length - 1;
                  break;
                default:
                  return;
              }
              event.preventDefault();
              setSelectedType(NOTE_TYPES[next]!);
              const tabs =
                event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
                  '[role="tab"]'
                );
              tabs?.[next]?.focus();
            }}
          >
            {NOTE_TYPE_LABELS[type]}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={`${id}-panel-${selectedType}`}
        aria-labelledby={`${id}-tab-${selectedType}`}
      >
        <label>
          笔记正文
          <textarea
            ref={textarea}
            value={text}
            disabled={busy}
            onChange={(event) => {
              patch(selectedType, { text: event.target.value, didSave: false });
            }}
          />
        </label>
        <p className="note-limit">
          {text.length.toLocaleString()} / {NOTE_TEXT_LIMIT.toLocaleString()}{" "}
          字符；每书最多 100 条
        </p>
        {text.length > NOTE_TEXT_LIMIT ? (
          <p role="alert">笔记正文最多 10,000 字符，请缩短后重试。</p>
        ) : null}
        {/* Over-limit text fails on its own limit; the generic quota/100-notes
          alert would misattribute that failure. */}
        {operation.failed && text.length <= NOTE_TEXT_LIMIT ? (
          <p role="alert">
            笔记写入失败：可能已达每书 100
            条或本地存储配额，请重试。草稿已保留。
          </p>
        ) : null}
        {didSave && text === saved ? (
          <p role="status">{exists ? "已存" : "已删除"}</p>
        ) : null}
        <div className="note-actions">
          <button
            type="button"
            disabled={busy || !text.trim()}
            onClick={() => void write(false)}
          >
            {busy ? "处理中…" : "保存"}
          </button>
          {exists ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void write(true)}
            >
              删除
            </button>
          ) : null}
          <button type="button" onClick={requestClose}>
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
