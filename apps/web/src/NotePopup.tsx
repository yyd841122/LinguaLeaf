import { useEffect, useImperativeHandle, useRef, type Ref } from "react";
import {
  anchorPopup,
  POPUP_WIDTH_PX,
  POPUP_MAX_HEIGHT_PX,
  type ClickPoint,
} from "@lingualeaf/reading-model";
import {
  NotePanels,
  type NotePanelsHandle,
  type NotePanelsProps,
} from "./NotePanels";

export type NotePopupHandle = { requestClose: () => boolean };
export function NotePopup({
  notes,
  point,
  onClose,
  onSave,
  onDelete,
  ref,
}: NotePanelsProps & {
  point: ClickPoint;
  onClose: () => void;
  ref: Ref<NotePopupHandle>;
}) {
  const container = useRef<HTMLDivElement>(null);
  const panels = useRef<NotePanelsHandle>(null);
  const closed = useRef(false);
  const requestClose = () => {
    if (closed.current) return true;
    if (panels.current?.requestClose() === false) return false;
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
  const position = anchorPopup(point, {
    width: window.innerWidth,
    height: window.innerHeight,
  });
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
      <NotePanels
        ref={panels}
        notes={notes}
        onSave={onSave}
        onDelete={onDelete}
      />
      <button type="button" onClick={requestClose}>
        关闭
      </button>
    </div>
  );
}
