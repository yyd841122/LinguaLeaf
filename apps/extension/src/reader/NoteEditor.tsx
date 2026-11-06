import {
  anchorPopup,
  POPUP_MAX_HEIGHT_PX,
  POPUP_WIDTH_PX,
} from "@lingualeaf/reading-model";
import { useOwner, useSettle } from "@lingualeaf/reading-model/react";
import {
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
} from "react";
import {
  NOTE_TEXT_LIMIT,
  type NoteAnchor,
  type NotesStore,
  type ReaderNote,
} from "../store/notes-store";

export type NoteEditorHandle = { requestClose(): boolean };

// Extension-owned single-text editor. The kernel supplies only the button;
// no web wire types, note categories or server session enter this host.
export function NoteEditor({
  anchor,
  initial,
  button,
  store,
  onCommitted,
  onClose,
  ref,
}: {
  anchor: NoteAnchor;
  initial: ReaderNote | undefined;
  button: HTMLButtonElement;
  store: NotesStore;
  onCommitted: (note: ReaderNote | null) => void;
  onClose: () => void;
  ref: Ref<NoteEditorHandle>;
}) {
  const [text, setText] = useState(initial?.text ?? "");
  const [saved, setSaved] = useState(initial?.text ?? "");
  const [exists, setExists] = useState(!!initial);
  const [busy, setBusy] = useState(false);
  const [didSave, setDidSave] = useState(false);
  const busyRef = useRef(false);
  const closed = useRef(false);
  const box = useRef<HTMLDivElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const owner = useOwner(anchor.docId, anchor.chapterIndex, anchor.blockIndex);
  const operation = useSettle(owner);
  const dirty = text !== saved;
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
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setDidSave(false);
    const submitted = text;
    const result = await operation.run(
      remove
        ? store.delete(anchor).then(() => null)
        : store.save(anchor, submitted),
      {
        // A write belongs to storage even if the editor has closed. Only
        // the chapter's own owner may update its markers; drafts stay local.
        onLanded: onCommitted,
        onFresh: (note) => {
          setExists(note !== null);
          setSaved(note?.text ?? "");
          setText(note?.text ?? "");
          setDidSave(true);
        },
      }
    );
    if (result.fresh) {
      busyRef.current = false;
      setBusy(false);
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
      aria-label="句子块笔记"
      ref={box}
      style={{
        ...position,
        width: POPUP_WIDTH_PX,
        maxHeight: POPUP_MAX_HEIGHT_PX,
      }}
    >
      <label>
        笔记正文
        <textarea
          ref={textarea}
          value={text}
          disabled={busy}
          onChange={(event) => {
            setText(event.target.value);
            setDidSave(false);
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
          笔记写入失败：可能已达每书 100 条或本地存储配额，请重试。草稿已保留。
        </p>
      ) : null}
      {didSave && !dirty ? (
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
  );
}
