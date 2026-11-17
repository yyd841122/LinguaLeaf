import {
  createWordHandlers,
  useOwner,
  useSettle,
  type WordClick,
} from "@lingualeaf/reading-model/react";
import {
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
  type RefObject,
} from "react";
import type { IpaLookup } from "@lingualeaf/import-core";
import {
  renderPdfPage,
  invalidatePdfRender,
  clearPdfOverlay,
  type PdfLineGeo,
  type PdfSession,
} from "./pdf";
import type { PdfNote, PdfNotesStore } from "../store/pdf-notes-store";
import type { PdfPositionStore } from "../store/pdf-position-store";
import {
  byReadingOrder,
  isPdfRow,
  type BookmarkStore,
  type PdfBookmarkRow,
} from "../store/bookmark-store";
import { formatPlantedAt } from "./bookmark-view";
import { NoteEditor, type NoteEditorHandle } from "./NoteEditor";
import { PdfReflow } from "./PdfReflow";
import type { PdfViewMode } from "../store/pdf-position-store";
import { ReaderMenu, type ReaderMenuItem } from "./ReaderMenu";
import { AaPanel } from "./AaPanel";
import { isInteractiveTarget, selectionActive } from "./tapZones";
import type { LearningSettingsStore } from "../store/learning-settings-store";
import {
  FONT_STEPS,
  LINE_STEPS,
  MARGIN_STEPS,
  type ThemePreference,
  type Typography,
} from "../store/ui-settings-store";

// The PDF reading view (ticket 06): one page on canvas at a time — a big
// book is progressive by shape — with the proven word/IPA overlay. Word
// units carry data-word, so the popup seam is the EPUB one verbatim.
// The bookmark face (ticket 03, 人验 round 4): marks hang on a LINE, not
// the page — the EPUB face marks blocks, the PDF's unit is the visual
// line. Plant via the button (the topmost visible line, the EPUB
// topmost-visible rule) or by long-pressing a word (that line); the
// panel lists, jumps and deletes.
export function PdfReader({
  docId,
  notes,
  positions,
  bookmarks,
  editorRef,
  onOpenNote,
  title,
  session,
  page,
  scale,
  lookup,
  learning,
  typography,
  onTypography,
  theme,
  initialView = "canvas",
  onPage,
  onScale,
  onWordClick,
  onReopen,
}: {
  docId: string;
  notes: PdfNotesStore;
  positions: PdfPositionStore;
  bookmarks: BookmarkStore;
  editorRef: RefObject<NoteEditorHandle | null>;
  onOpenNote: () => void;
  title: string;
  session: PdfSession;
  page: number;
  scale: number;
  lookup: IpaLookup;
  // 逐书学习开关 + 排版/主题 (redesign 02): the EPUB face's same seams.
  learning: LearningSettingsStore;
  typography: Typography;
  onTypography: (steps: Partial<Typography>) => void;
  theme: {
    preference: ThemePreference;
    save: (next: ThemePreference) => void;
  };
  // The face the doc reopens into (persisted per doc in the position
  // store; canvas — the coordinate-overlay gate's form — is the default).
  initialView?: PdfViewMode;
  onPage: (page: number) => void;
  onScale: (scale: number) => void;
  onWordClick: (click: WordClick) => void;
  onReopen: () => void;
}) {
  const stage = useRef<ReaderFaceHandle>(null);
  const navigate = (apply: () => void) => {
    if (editorRef.current?.requestClose() === false) return;
    stage.current?.invalidate();
    apply();
  };
  // The reading face (round 7): reflow (EPUB-shaped lines) or the
  // original canvas. Persisted with the position so a doc reopens into
  // the face its reader chose.
  const [view, setView] = useState<PdfViewMode>(initialView);
  useEffect(() => {
    void positions.setPosition({ docId, title, page, scale, view });
  }, [positions, docId, title, page, scale, view]);
  // The shell's height pins to the layout viewport's client height (round
  // 8's defect: 100vh followed innerHeight while the ICB sat 66px
  // shorter — the gap became body scroll range, and any push shifted the
  // whole shell up under the header). clientHeight never leaves a
  // scrollable remainder; resize keeps it honest.
  useEffect(() => {
    const apply = () =>
      document.documentElement.style.setProperty(
        "--shell-h",
        `${document.documentElement.clientHeight}px`
      );
    apply();
    window.addEventListener("resize", apply);
    // The root scroller has no job while the face is up — lock it so no
    // gesture or scroll chain can ever push the shell.
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("resize", apply);
      document.body.style.overflow = "";
    };
  }, []);
  // The summonable menu (redesign 02): the resident header, tools row
  // and pager are gone — the bars summon on a background tap, the page
  // flips ride the edge strips, and the zoom ladder + the 原版/重排
  // switch live in the menu's own row (spec round 2 #2's PDF 减法: keep
  // 音标 in both views, no 译文, no 听书).
  const [menuOpen, setMenuOpen] = useState(false);
  const [panel, setPanel] = useState<"pages" | "bookmarks" | "aa" | null>(null);
  const openPanel = (next: NonNullable<typeof panel>) => {
    setMenuOpen(false);
    setPanel(next);
  };
  const closePanel = () => setPanel(null);
  // 逐书学习开关 (redesign 02): 音标 defaults on (the old global value)
  // and loads per book; every flip persists at once.
  const [showIpa, setShowIpa] = useState(true);
  useEffect(() => {
    let cancelled = false;
    learning
      .load(docId)
      .then((toggles) => {
        if (!cancelled) setShowIpa(toggles.ipa);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [learning, docId]);
  const toggleIpa = () => {
    setShowIpa((shown) => {
      void learning.save(docId, { ipa: !shown });
      return !shown;
    });
  };
  // 点按分区 (spec review finding 13): a background tap summons or
  // dismisses; words/pens/controls win; a selection is the reader's; a
  // panel's veil owns everything.
  const onSurfaceTap = (event: React.MouseEvent<HTMLElement>) => {
    if (panel !== null) return;
    if (isInteractiveTarget(event.target)) return;
    if (selectionActive()) return;
    setMenuOpen((open) => !open);
  };
  const menuItems: ReaderMenuItem[] = [
    { key: "pages", label: "页码" },
    { key: "bookmarks", label: "书签" },
    { key: "ipa", label: "音标", active: showIpa },
    ...(view === "canvas"
      ? [0.75, 1, 1.5].map((zoom): ReaderMenuItem => ({
          key: `zoom:${zoom}`,
          // 100% reads as fit-width (round 5).
          label: zoom === 1 ? "适宽" : `${zoom * 100}%`,
          active: scale === zoom,
        }))
      : []),
    { key: "view", label: view === "reflow" ? "原版" : "重排" },
    { key: "aa", label: "Aa" },
  ];
  const onMenuItem = (key: string) => {
    if (key === "ipa") {
      navigate(toggleIpa);
      return;
    }
    if (key.startsWith("zoom:")) {
      const zoom = Number(key.slice("zoom:".length));
      if (zoom !== scale) navigate(() => onScale(zoom));
      return;
    }
    if (key === "view") {
      navigate(() =>
        setView((mode) => (mode === "reflow" ? "canvas" : "reflow"))
      );
      return;
    }
    if (editorRef.current?.requestClose() === false) return;
    onOpenNote();
    if (key === "bookmarks" || key === "aa" || key === "pages") {
      openPanel(key);
    }
  };
  // The page-nav panel's draft (目录面板 = 页导航, spec round 2 #2).
  const [pageDraft, setPageDraft] = useState(String(page));
  useEffect(() => setPageDraft(String(page)), [page]);
  const jumpToDraft = () => {
    const target = Number(pageDraft);
    if (!Number.isInteger(target)) return;
    const clamped = Math.min(Math.max(target, 1), session.pageCount);
    closePanel();
    if (clamped !== page) navigate(() => onPage(clamped));
  };

  // The bookmark seam (ticket 03): planted page marks for this document.
  // Same channel discipline as the EPUB face — one owner carries the
  // list, the plant and the remove; the mount read is silent (markers
  // best-effort) while a fresh panel open refetches and flags failures.
  const [bookmarkRows, setBookmarkRows] = useState<PdfBookmarkRow[] | null>(
    null
  );
  // The panel's own loading surface, separate from the shared snapshot —
  // the EPUB face's same fix: wiping the rows on open blanked the page
  // marks too (pageMarks derive from them), and a close before the
  // refetch landed — the cleanup invalidates the read's ticket — left
  // them gone while the store still held the marks.
  const [panelRowsLoading, setPanelRowsLoading] = useState(false);
  const [bookmarkAttempt, setBookmarkAttempt] = useState(0);
  // The armed jump (ticket 10's same shape): the row's line scrolls into
  // view once its page's render settles — PdfPage owns the scroll.
  const [jumpLine, setJumpLine] = useState<{
    page: number;
    line: number;
  } | null>(null);
  const bookmarksOwner = useOwner();
  const bookmarksSettle = useSettle(bookmarksOwner);
  const runBookmarks = bookmarksSettle.run;
  useEffect(() => {
    void runBookmarks(bookmarks.list(docId), {
      onFresh: (rows) => setBookmarkRows(rows.filter(isPdfRow)),
    });
    return () => bookmarksOwner.invalidate();
  }, [bookmarks, docId, runBookmarks, bookmarksOwner]);
  useEffect(() => {
    if (panel !== "bookmarks") return;
    setPanelRowsLoading(true);
    void runBookmarks(bookmarks.list(docId), {
      onFresh: (rows) => {
        setBookmarkRows(rows.filter(isPdfRow));
        setPanelRowsLoading(false);
      },
    });
    return () => {
      bookmarksOwner.invalidate();
      setPanelRowsLoading(false);
    };
  }, [bookmarks, docId, panel, bookmarkAttempt, runBookmarks, bookmarksOwner]);
  // 打书签: the plant lands on a LINE, and the store's same-position
  // idempotence makes a replant one mark.
  const plantBookmarkAt = (line: number, text: string) => {
    void runBookmarks(bookmarks.add(docId, { page, line, text }), {
      onFresh: (row) =>
        setBookmarkRows((current) => {
          if (!isPdfRow(row)) return current;
          const rows = current ?? [];
          return rows.some((existing) => existing.id === row.id)
            ? rows
            : [...rows, row].sort(byReadingOrder);
        }),
    });
  };
  // The button plants where the reader is: the topmost visible line —
  // the EPUB face's topmost-visible rule at the PDF's own unit. No
  // settled render yet (rare: the panel needs the read anyway) falls
  // back to the page top.
  const plantBookmark = () => {
    const at = stage.current?.topmostVisibleLine();
    plantBookmarkAt(at?.line ?? 0, at?.text ?? "");
  };
  const removeBookmark = (id: number) => {
    void runBookmarks(bookmarks.remove(docId, id), {
      onFresh: () =>
        setBookmarkRows((current) =>
          (current ?? []).filter((row) => row.id !== id)
        ),
    });
  };
  // 跳回: flip to the row's page when it differs, then the armed jump
  // brings the row's line into view (either face, after its read lands).
  const jumpToBookmark = (row: PdfBookmarkRow) => {
    if (editorRef.current?.requestClose() === false) return;
    closePanel();
    setJumpLine({ page: row.page, line: row.line });
    if (row.page !== page) navigate(() => onPage(row.page));
  };
  const pageMarks = (bookmarkRows ?? [])
    .filter((row) => row.page === page)
    .map((row) => ({ line: row.line }));

  return (
    // Both faces read in a fixed-height shell (rounds 8-9): sticky
    // heads proved unreliable in the WebView under deep scroll, and a
    // 100vh shell on the ICB-less layout viewport left body scroll
    // slack that shoved the whole shell up. The shell pins the header
    // and the pager, locks the root scroller, and each face scrolls in
    // its own region — the header cannot move under any gesture.
    <main
      className="reader reader-shell"
      aria-label="扩展阅读页"
      onClick={onSurfaceTap}
      style={
        {
          // The reflow face reads the typography ladder; the canvas
          // face's page is its own geometry (纸就是纸).
          "--original-size": FONT_STEPS[typography.fontStep],
          "--reader-margin": MARGIN_STEPS[typography.marginStep],
          "--reader-leading": showIpa ? "2" : LINE_STEPS[typography.lineStep],
        } as React.CSSProperties
      }
    >
      <ReaderMenu
        open={menuOpen}
        title={title}
        progress={`${page} / ${session.pageCount}`}
        items={menuItems}
        onBack={() => navigate(onReopen)}
        onSelect={onMenuItem}
      />
      {!menuOpen && panel === null ? (
        <>
          <button
            type="button"
            className="reader-edge reader-edge-left"
            aria-label="上一页"
            disabled={page <= 1}
            onClick={() => navigate(() => onPage(page - 1))}
          />
          <button
            type="button"
            className="reader-edge reader-edge-right"
            aria-label="下一页"
            disabled={page >= session.pageCount}
            onClick={() => navigate(() => onPage(page + 1))}
          />
        </>
      ) : null}
      {/* Both faces read the same rows, armed jump and plant channel —
          the marks made in one face read true in the other. */}
      {view === "reflow" ? (
        <PdfReflow
          key={`${page}:reflow`}
          ref={stage}
          docId={docId}
          session={session}
          page={page}
          lookup={lookup}
          showIpa={showIpa}
          notes={notes}
          marks={pageMarks}
          jumpLine={jumpLine}
          onJumpSettled={() => setJumpLine(null)}
          onLongPressLine={plantBookmarkAt}
          editorRef={editorRef}
          onOpenNote={onOpenNote}
          onWordClick={onWordClick}
        />
      ) : (
        <PdfPage
          key={`${page}:${scale}:${showIpa}`}
          ref={stage}
          docId={docId}
          session={session}
          page={page}
          scale={scale}
          lookup={lookup}
          showIpa={showIpa}
          marks={pageMarks}
          jumpLine={jumpLine}
          onJumpSettled={() => setJumpLine(null)}
          onLongPressLine={plantBookmarkAt}
          notes={notes}
          editorRef={editorRef}
          onOpenNote={onOpenNote}
          onWordClick={onWordClick}
        />
      )}
      {panel === "bookmarks" ? (
        <div className="overlay-veil" role="dialog" aria-label="书签">
          <div className="overlay-card bookmark-card">
            <h2 className="overlay-title">书签</h2>
            <button
              type="button"
              className="bookmark-plant"
              // The plant waits for the open's read: planting into a
              // pending list would merge the row locally, only for the
              // older snapshot to overwrite the panel when its read
              // lands (one channel, no invalidate between the marks).
              disabled={panelRowsLoading}
              onClick={plantBookmark}
            >
              在当前位置打书签
            </button>
            {/* One channel for the list and both ops: a fresh failure
                raises this flag, a fresh success retires it. The retry
                re-reads the list — fresh truth also settles a failed
                op's aftermath. */}
            {bookmarksSettle.failed ? (
              <p className="reader-error" role="alert">
                书签操作失败，请重试。
                <button
                  type="button"
                  onClick={() => setBookmarkAttempt((value) => value + 1)}
                >
                  重试读取书签
                </button>
              </p>
            ) : null}
            {/* The panel's wait is its own state, not the snapshot: the
                wait line shows only while NOTHING has landed and no
                failure speaks — a failure with no snapshot shows the
                flag alone, and landed rows stay listed through a
                retry's refetch. */}
            {bookmarkRows === null ? (
              bookmarksSettle.failed ? null : (
                <p className="reader-status">读取书签中…</p>
              )
            ) : bookmarkRows.length === 0 ? (
              <p className="reader-status">
                还没有书签。点「在当前位置打书签」钉住当前视线，或长按任意单词把签钉在那一句。
              </p>
            ) : (
              <ul className="bookmark-list">
                {bookmarkRows.map((row) => {
                  const label = `第 ${row.page} 页${row.text ? ` · ${row.text.slice(0, 14)}` : ""}`;
                  return (
                    <li key={row.id} className="bookmark-row">
                      <button
                        type="button"
                        className="bookmark-jump"
                        onClick={() => jumpToBookmark(row)}
                      >
                        <span className="bookmark-title">{label}</span>
                        <span className="bookmark-at">
                          {formatPlantedAt(row.createdAt)}
                        </span>
                      </button>
                      <button
                        type="button"
                        className="bookmark-delete"
                        aria-label={`删除书签：${label}`}
                        // A pending (re)fetch locks the ops: a delete
                        // landing mid-refetch races the list read — the
                        // read started before it can resolve after it
                        // and resurrect the row with its stale snapshot.
                        disabled={panelRowsLoading}
                        onClick={() => removeBookmark(row.id)}
                      >
                        删除
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            <div className="overlay-actions">
              <button type="button" onClick={closePanel}>
                关闭
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {panel === "pages" ? (
        <div className="overlay-veil" role="dialog" aria-label="页码">
          <div className="overlay-card">
            <h2 className="overlay-title">页码</h2>
            <div className="aa-row" role="group" aria-label="跳转页码">
              <input
                type="number"
                min={1}
                max={session.pageCount}
                value={pageDraft}
                aria-label="页码"
                onChange={(event) => setPageDraft(event.target.value)}
              />
              <span className="aa-value">/ {session.pageCount}</span>
              <button type="button" onClick={jumpToDraft}>
                跳转
              </button>
            </div>
            <div className="overlay-actions">
              <button type="button" onClick={closePanel}>
                关闭
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {panel === "aa" ? (
        <div className="overlay-veil" role="dialog" aria-label="排版与主题">
          <div className="overlay-card aa-card">
            <AaPanel
              typography={typography}
              onTypography={onTypography}
              theme={theme}
            />
            <div className="overlay-actions">
              <button type="button" onClick={closePanel}>
                关闭
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

// Both faces carry the same handle: the canvas render's invalidation
// and the reading-walk anchor — the EPUB topmost-visible rule at the
// PDF's line granularity: the visible line closest to the face's top
// is where the reader is.
type ReaderFaceHandle = {
  invalidate(): void;
  topmostVisibleLine(): { line: number; text: string } | null;
};
function PdfPage({
  docId,
  session,
  page,
  scale,
  lookup,
  showIpa,
  marks,
  jumpLine,
  onJumpSettled,
  onLongPressLine,
  notes,
  editorRef,
  onOpenNote,
  onWordClick,
  ref,
}: {
  docId: string;
  session: PdfSession;
  page: number;
  scale: number;
  lookup: IpaLookup;
  showIpa: boolean;
  // This page's planted lines — the face-level marker facts (the EPUB
  // face derives the same from its rows). Render-reactive: a plant or
  // delete through the panel or a long-press shows/hides the strips
  // without remount.
  marks: { line: number }[];
  jumpLine: { page: number; line: number } | null;
  onJumpSettled: () => void;
  onLongPressLine: (line: number, text: string) => void;
  notes: PdfNotesStore;
  editorRef: RefObject<NoteEditorHandle | null>;
  onOpenNote: () => void;
  onWordClick: (click: WordClick) => void;
  ref: Ref<ReaderFaceHandle>;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  // The render's line geometry (round 4): the facts the per-line
  // markers, the long-press plant and the jump scroll all read.
  const [lineGeo, setLineGeo] = useState<PdfLineGeo[]>([]);
  const [saved, setSaved] = useState<PdfNote[] | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [popup, setPopup] = useState<{
    lineIndex: number;
    lineText: string;
    button: HTMLButtonElement;
    op: number;
  } | null>(null);
  const nextOp = useRef(0);
  const renderOwner = useOwner(docId, session, page, scale, showIpa);
  const { run: render, failed: renderFailed } = useSettle(renderOwner);
  const readOwner = useOwner(docId, session, page, notes);
  const { run: read, failed } = useSettle(readOwner);
  const markerOwner = useOwner(docId, session, page);
  const { run: patch } = useSettle(markerOwner);
  useImperativeHandle(
    ref,
    () => ({
      invalidate() {
        renderOwner.invalidate();
        readOwner.invalidate();
        markerOwner.invalidate();
        if (overlay.current) {
          invalidatePdfRender(overlay.current);
          clearPdfOverlay(overlay.current);
        }
      },
      topmostVisibleLine() {
        const el = overlay.current;
        if (!el || lineGeo.length === 0) return null;
        const stageTop = el.getBoundingClientRect().top;
        let best: { top: number; geo: PdfLineGeo } | null = null;
        for (const geo of lineGeo) {
          const span = el.querySelector(
            `[data-pdf-line-index="${geo.lineIndex}"]`
          );
          if (!span) continue;
          const top = span.getBoundingClientRect().top;
          if (top >= stageTop - 1 && (best === null || top < best.top))
            best = { top, geo };
        }
        return best ? { line: best.geo.lineIndex, text: best.geo.text } : null;
      },
    }),
    [lineGeo, renderOwner, readOwner, markerOwner]
  );
  // The armed jump (the EPUB face's same shape): once this page's
  // overlay exists, bring the row's line into view and disarm. A jump
  // whose line never renders (a replaced book) sits unarmed until the
  // next jump replaces it.
  useEffect(() => {
    if (!ready || !jumpLine || jumpLine.page !== page) return;
    const raf = requestAnimationFrame(() => {
      overlay.current
        ?.querySelector(`[data-pdf-line-index="${jumpLine.line}"]`)
        ?.scrollIntoView?.({ block: "center" });
      onJumpSettled();
    });
    return () => cancelAnimationFrame(raf);
  }, [ready, jumpLine, page, onJumpSettled]);
  // 长按打签: pressing a word for the long-press beat plants a mark on
  // its line — the direct "mark THIS paragraph" gesture — and swallows
  // the click the release would otherwise turn into a lookup. A scroll
  // (move past 10px) cancels like any press.
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressOrigin = useRef<{ x: number; y: number } | null>(null);
  const suppressClick = useRef(false);
  const clearPress = () => {
    if (pressTimer.current !== null) clearTimeout(pressTimer.current);
    pressTimer.current = null;
    pressOrigin.current = null;
  };
  useEffect(() => () => clearPress(), []);
  const lineAt = (target: EventTarget | null): PdfLineGeo | null => {
    const el = (target as HTMLElement | null)?.closest?.(
      "[data-pdf-line-index]"
    );
    const index = el?.getAttribute("data-pdf-line-index");
    if (index === null || index === undefined) return null;
    return lineGeo.find((geo) => String(geo.lineIndex) === index) ?? null;
  };
  useEffect(() => {
    const target = overlay.current;
    if (!canvas.current || !target) return;
    void render(
      renderPdfPage(
        canvas.current,
        target,
        session.doc,
        page,
        scale,
        lookup,
        showIpa
      ),
      {
        onFresh: (result) => {
          setLineGeo(result.lines);
          setReady(true);
        },
      }
    );
    return () => {
      renderOwner.invalidate();
      invalidatePdfRender(target);
      clearPdfOverlay(target);
    };
  }, [session, page, scale, lookup, showIpa, render, renderOwner]);
  useEffect(() => {
    void read(notes.list(docId), { onFresh: setSaved });
    return () => readOwner.invalidate();
  }, [notes, docId, attempt, read, readOwner]);
  useEffect(() => () => markerOwner.invalidate(), [markerOwner]);

  // Rendering, reads and marker patches each settle under their own owner.
  // Canonical text is carried by the render's eligiblePdfLines result in DOM.
  const [drift, setDrift] = useState(false);
  useEffect(() => {
    if (!ready || !overlay.current) return;
    const buttons = [
      ...overlay.current.querySelectorAll<HTMLButtonElement>("[data-pdf-note]"),
    ];
    const pageNotes = (saved ?? []).filter((note) => note.page === page);
    setDrift(
      pageNotes.some(
        (note) =>
          !buttons.some(
            (button) =>
              Number(button.dataset.pdfNote) === note.lineIndex &&
              button.dataset.lineText === note.lineText
          )
      )
    );
    const ticket = markerOwner.mark();
    for (const button of buttons) {
      const lineIndex = Number(button.dataset.pdfNote);
      const lineText = button.dataset.lineText!;
      const lineNotes = pageNotes.filter(
        (entry) => entry.lineIndex === lineIndex
      );
      const matches = lineNotes.some((note) => note.lineText === lineText);
      const mismatches = lineNotes.some((note) => note.lineText !== lineText);
      button.disabled = saved === null || failed || mismatches;
      button.classList.toggle("has-note", matches);
      button.setAttribute(
        "aria-label",
        lineNotes.length ? "编辑笔记" : "写笔记"
      );
      button.onclick = () => {
        if (
          ticket.stale() ||
          button.disabled ||
          editorRef.current?.requestClose() === false
        )
          return;
        onOpenNote();
        setPopup({ lineIndex, lineText, button, op: ++nextOp.current });
      };
    }
    return () => {
      for (const button of buttons) button.onclick = null;
    };
  }, [ready, saved, failed, page, markerOwner, editorRef, onOpenNote]);
  const markerTicket = markerOwner.mark();
  return (
    <>
      {renderFailed ? (
        <p role="alert" className="reader-error">
          PDF 页面渲染失败，请切页或重新打开文件。
        </p>
      ) : null}
      {failed ? (
        <p role="alert" className="reader-error">
          笔记读取失败，无法确认已有笔记。
          <button
            type="button"
            onClick={() => {
              readOwner.invalidate();
              setAttempt((value) => value + 1);
            }}
          >
            重试读取笔记
          </button>
        </p>
      ) : null}
      {drift ? (
        <p role="alert" className="reader-error">
          已有笔记与本页行文本不符，已保留原笔记，未回挂不符条目。
        </p>
      ) : null}
      <div
        className="pdf-stage"
        ref={overlay}
        {...createWordHandlers((click) => {
          if (suppressClick.current) {
            suppressClick.current = false;
            return;
          }
          onWordClick(click);
        })}
        role="presentation"
        onPointerDown={(event) => {
          const geo = lineAt(event.target);
          if (!geo) return;
          pressOrigin.current = { x: event.clientX, y: event.clientY };
          pressTimer.current = setTimeout(() => {
            suppressClick.current = true;
            onLongPressLine(geo.lineIndex, geo.text);
          }, 500);
        }}
        onPointerMove={(event) => {
          const origin = pressOrigin.current;
          if (
            pressTimer.current !== null &&
            origin &&
            Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 10
          )
            clearPress();
        }}
        onPointerUp={clearPress}
        onPointerCancel={clearPress}
        onContextMenu={(event) => {
          if (lineAt(event.target)) event.preventDefault();
        }}
      >
        <canvas ref={canvas} />
        {marks.map(({ line }) => {
          const geo = lineGeo.find((entry) => entry.lineIndex === line);
          if (!geo) return null;
          return (
            // The planted-line marker: the EPUB face's 紫条+飘带 at line
            // granularity (ticket 03 人验 round 4).
            <div
              key={line}
              className="pdf-bookmark-mark"
              aria-hidden="true"
              style={{ top: `${geo.top}px`, height: `${geo.height}px` }}
            />
          );
        })}
      </div>
      {popup ? (
        <NoteEditor
          key={popup.op}
          ref={editorRef}
          ownerKey={`${docId}:${page}:${popup.lineIndex}`}
          ariaLabel="行笔记"
          initial={(saved ?? []).filter(
            (note) => note.page === page && note.lineIndex === popup.lineIndex
          )}
          button={popup.button}
          store={{
            save: (type, text) =>
              notes.save(
                {
                  type,
                  docId,
                  page,
                  lineIndex: popup.lineIndex,
                  lineText: popup.lineText,
                },
                text
              ),
            delete: (type) =>
              notes.delete({ docId, page, lineIndex: popup.lineIndex, type }),
          }}
          onCommitted={(type, note) => {
            void patch(Promise.resolve(note), {
              ticket: markerTicket,
              onFresh: (value) =>
                setSaved((current) => {
                  const rest = (current ?? []).filter(
                    (entry) =>
                      entry.page !== page ||
                      entry.lineIndex !== popup.lineIndex ||
                      entry.type !== type
                  );
                  return value ? [...rest, value] : rest;
                }),
            });
          }}
          onClose={() => setPopup(null)}
        />
      ) : null}
    </>
  );
}
