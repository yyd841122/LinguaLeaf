import { useEffect, useRef, useState } from "react";
import { useOwner, useSettle } from "@lingualeaf/reading-model/react";
import type { IpaLookup } from "@lingualeaf/import-core";
import { UploadRejected } from "@lingualeaf/import-core";
import type { OfflineDictionary } from "../dict/offline-dictionary";
import { readPdfBlob, type PdfBytesStore } from "../store/idb-bytes-store";
import type {
  PdfPositionStore,
  PdfViewMode,
} from "../store/pdf-position-store";
import { pdfFingerprint } from "../store/pdf-fingerprint";
import {
  classifyPdfError,
  destroyPdf,
  detectScanned,
  openPdf,
  sampleTextLengths,
  type PdfSession,
} from "./pdf";

export type OpenedPdf = {
  docId: string;
  title: string;
  session: PdfSession;
  page: number;
  scale: number;
  lookup: IpaLookup;
  // The face the doc last read in (round 7); absent on first open.
  view?: PdfViewMode | undefined;
};

// Own the open channel and every candidate session, including the interval
// between acceptance and React committing the PDF face. The host dispatches
// files and failures through this same channel; only acceptance admits bytes.
export function usePdfOpen({
  activeSession,
  pdfPositions,
  pdfBytes,
  refreshPdfShelf,
  onAccepted,
}: {
  activeSession: PdfSession | null;
  pdfPositions: PdfPositionStore;
  pdfBytes: PdfBytesStore;
  refreshPdfShelf: () => Promise<void>;
  onAccepted: (opened: OpenedPdf) => void;
}) {
  const [pdfSaveError, setPdfSaveError] = useState<string | null>(null);
  const openOwner = useOwner();
  const { run: runOpen } = useSettle(openOwner);
  // Accepted sessions are held immediately, including the interval before
  // React commits state and installs the session effect. Teardown can land
  // in that interval; the ref lets it release the transferred candidate.
  const acceptedSession = useRef<PdfSession | null>(null);
  useEffect(
    () => () => {
      openOwner.invalidate();
      const session = acceptedSession.current;
      acceptedSession.current = null;
      if (session) void destroyPdf(session);
    },
    [openOwner]
  );
  useEffect(
    () => () => {
      if (activeSession && acceptedSession.current === activeSession) {
        acceptedSession.current = null;
        void destroyPdf(activeSession);
      }
    },
    [activeSession]
  );

  const acceptPdf = async (
    blob: Blob,
    filename: string,
    offline: OfflineDictionary,
    openTicket: ReturnType<typeof openOwner.mark>,
    save: boolean,
    expectedDocId?: string,
    // The shelf's stored name (mobile-ipa-buttons 04): a hand-renamed
    // title outranks the PDF's own metadata on every reopen — otherwise
    // 「www.i-enet.com」 would keep greeting the reader above a book the
    // shelf already calls 《Candide 老实人》. Absent (fresh imports), the
    // session's metadata-first title stands.
    storedTitle?: string
  ) => {
    const bytes = await readPdfBlob(blob);
    const docId = await pdfFingerprint(bytes);
    if (expectedDocId && docId !== expectedDocId)
      throw new Error("PDF 书架字节与所选书不符");
    if (openTicket.stale()) return;
    let session: PdfSession;
    try {
      session = await openPdf(bytes, filename);
    } catch (error) {
      const reason = classifyPdfError(error);
      if (!reason) throw error;
      throw new UploadRejected(reason, String(error));
    }
    let transferred = false;
    try {
      if (openTicket.stale()) return;
      const lengths = await sampleTextLengths(session.doc);
      if (detectScanned(lengths))
        throw new UploadRejected(
          "scanned-pdf",
          "image-only PDF has no text layer"
        );
      const position = await pdfPositions.getPosition(docId);
      await runOpen(Promise.resolve(session), {
        ticket: openTicket,
        onFresh: () => {
          transferred = true;
          acceptedSession.current = session;
          setPdfSaveError(null);
          onAccepted({
            docId,
            title: storedTitle ?? session.title,
            session,
            page: Math.min(session.pageCount, Math.max(1, position?.page ?? 1)),
            scale: position?.scale ?? 1,
            lookup: offline.ipaLookup(),
            view: position?.view,
          });
        },
      });
      // Acceptance is the only shelf admission point. Do not await storage
      // on the reading path; the File is retained by the queued save.
      if (transferred && save) {
        const saving = pdfBytes.save({ docId, title: session.title, blob });
        // A commit refreshes the current picker even if the originating
        // session has already been left. Only feedback follows its ticket.
        void saving.then(refreshPdfShelf, refreshPdfShelf);
        void runOpen(
          saving.then(
            () => null,
            () => "PDF 未能存入书架，请重选同一个文件重试。"
          ),
          {
            ticket: openTicket,
            onFresh: setPdfSaveError,
          }
        );
      }
    } finally {
      if (!transferred) await destroyPdf(session);
    }
  };

  return { acceptPdf, openOwner, runOpen, pdfSaveError };
}
