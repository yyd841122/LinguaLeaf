import { useCallback, useEffect, useRef, useState } from "react";
import { useOwner, useSettle } from "@lingualeaf/reading-model/react";
import type { PdfBytesMetadata, PdfBytesStore } from "../store/idb-bytes-store";
import type { PdfPositionStore, PdfRecent } from "../store/pdf-position-store";

export type PdfShelfEntry = PdfBytesMetadata & { page: number };
export function usePdfShelf(
  bytes: PdfBytesStore,
  positions: PdfPositionStore,
  visible: boolean
) {
  const [snapshot, setSnapshot] = useState<{
    entries: PdfShelfEntry[];
    recent: PdfRecent | null;
  } | null>(null);
  const owner = useOwner(bytes, positions, visible);
  const { run, failed } = useSettle(owner);
  const mounted = useRef(false);
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const refresh = useCallback(async () => {
    if (!mounted.current || !visibleRef.current) return;
    owner.invalidate();
    await run(
      Promise.all([bytes.list(), positions.getSnapshot()]).then(
        ([entries, saved]) => {
          const pages = new Map(
            saved.positions.map((entry) => [entry.docId, entry.page])
          );
          return {
            entries: entries.map((entry) => ({
              ...entry,
              page: pages.get(entry.docId) ?? 1,
            })),
            recent: saved.recent,
          };
        }
      ),
      { onFresh: setSnapshot }
    );
  }, [bytes, positions, owner, run]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      owner.invalidate();
    };
  }, [owner]);
  useEffect(() => {
    if (visible) void refresh();
    return () => owner.invalidate();
  }, [visible, refresh, owner]);
  return { snapshot, failed, refresh };
}
