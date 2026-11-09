import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TextItem } from "pdfjs-dist/types/src/display/api";
import type { PdfSession } from "../src/reader/pdf";

const pdfjs = vi.hoisted(() => ({ getDocument: vi.fn() }));
vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: {},
  getDocument: pdfjs.getDocument,
  Util: {
    transform: (a: number[], b: number[]) => [
      a[0]! * b[0]!,
      0,
      0,
      a[3]! * b[3]!,
      a[0]! * b[4]! + a[4]!,
      a[3]! * b[5]! + a[5]!,
    ],
  },
}));
// Keep real renderer code; replace only pdf.js I/O and canvas drawing.
import {
  openPdf,
  renderPdfPage,
  clearPdfOverlay,
  invalidatePdfRender,
} from "../src/reader/pdf";
const item = (str: string, y: number): TextItem => ({
  str,
  dir: "ltr",
  width: 100,
  height: 12,
  transform: [12, 0, 0, 12, 40, y],
  fontName: "font",
  hasEOL: true,
});
function fixture() {
  const page = {
    getViewport: ({ scale }: { scale: number }) => ({
      width: 300 * scale,
      height: 400 * scale,
      transform: [scale, 0, 0, -scale, 0, 400 * scale],
    }),
    render: vi.fn(() => ({ promise: Promise.resolve() })),
    getTextContent: vi.fn(async () => ({
      items: [
        { type: "beginMarkedContent", id: "m" },
        item(" ", 350),
        item("...", 330),
        item("Hello—world", 300),
        item("Next line", 260),
      ],
    })),
    cleanup: vi.fn(),
  };
  const doc = { getPage: vi.fn(async () => page) };
  const canvas = document.createElement("canvas");
  vi.spyOn(canvas, "getContext").mockReturnValue(
    {} as CanvasRenderingContext2D
  );
  const overlay = document.createElement("div");
  overlay.appendChild(canvas);
  const render = (scale = 1, ipa = true) =>
    renderPdfPage(
      canvas,
      overlay,
      doc as unknown as PdfSession["doc"],
      1,
      scale,
      () => "ipa",
      ipa
    );
  return { page, doc, canvas, overlay, render };
}
beforeEach(() => {
  vi.restoreAllMocks();
});
describe("real PDF render overlay contract", () => {
  it("creates one disabled control per eligible line, keeps word keyboard targets and clears both kinds on rebuild", async () => {
    const f = fixture();
    await f.render();
    const buttons = [
      ...f.overlay.querySelectorAll<HTMLButtonElement>("[data-pdf-note]"),
    ];
    expect(
      buttons.map((b) => [b.dataset.pdfNote, b.dataset.lineText, b.disabled])
    ).toEqual([
      ["0", "Hello—world", true],
      ["1", "Next line", true],
    ]);
    expect(buttons[0]?.style.left).toBe("146px");
    expect(buttons[0]?.style.top).toBe("88px");
    expect(f.overlay.querySelectorAll("[data-pdf-word]")).toHaveLength(4);
    for (const word of f.overlay.querySelectorAll("[data-pdf-word]")) {
      expect(word).toHaveAttribute("tabindex", "0");
      expect(word).toHaveAttribute("role", "button");
    }
    const oldWords = [...f.overlay.querySelectorAll("[data-pdf-word]")];
    await f.render(1.5, false);
    expect(buttons.every((b) => !f.overlay.contains(b))).toBe(true);
    expect(oldWords.every((w) => !f.overlay.contains(w))).toBe(true);
    expect(f.overlay.querySelectorAll("[data-pdf-note]")).toHaveLength(2);
    expect(f.overlay.querySelectorAll(".pdf-ipa")).toHaveLength(0);
    expect(
      f.overlay.querySelector<HTMLElement>("[data-pdf-note]")?.style.left
    ).toBe("216px");
    clearPdfOverlay(f.overlay);
    expect(f.overlay.children).toHaveLength(1);
    expect(f.overlay.firstChild).toBe(f.canvas);
  });

  it("invalidates an in-flight extraction before it can apply word or note overlays", async () => {
    const f = fixture();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const content = f.page.getTextContent.bind(f.page);
    f.page.getTextContent = vi.fn(async () => {
      await gate;
      return content();
    });
    const pending = f.render();
    await vi.waitFor(() => expect(f.page.getTextContent).toHaveBeenCalled());
    invalidatePdfRender(f.overlay);
    release();
    await pending;
    expect(
      f.overlay.querySelectorAll("[data-pdf-word], [data-pdf-note]")
    ).toHaveLength(0);
    expect(f.page.cleanup).toHaveBeenCalledTimes(1);
  });

  it("discards a queued render revoked by navigation without fetching its page", async () => {
    const f = fixture();
    const run = f.render();
    invalidatePdfRender(f.overlay);
    await run;
    expect(f.doc.getPage).not.toHaveBeenCalled();
    expect(f.overlay.querySelector("[data-pdf-note]")).toBeNull();
  });

  it("does not resize the canvas or render after navigation while getPage is still pending", async () => {
    const f = fixture();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    f.doc.getPage = vi.fn(async () => {
      await gate;
      return f.page;
    });
    const pending = f.render();
    await vi.waitFor(() => expect(f.doc.getPage).toHaveBeenCalled());
    invalidatePdfRender(f.overlay);
    release();
    await pending;
    expect(f.page.render).not.toHaveBeenCalled();
    expect(f.canvas.style.width).toBe("");
    expect(f.page.cleanup).toHaveBeenCalledTimes(1);
  });

  it("cleans up on a failed render and keeps the render queue usable", async () => {
    const f = fixture();
    f.page.render.mockReturnValueOnce({
      promise: Promise.reject(new Error("render failure")),
    });
    await expect(f.render()).rejects.toThrow("render failure");
    expect(f.page.cleanup).toHaveBeenCalledTimes(1);
    await f.render();
    expect(f.overlay.querySelectorAll("[data-pdf-note]")).toHaveLength(2);
  });

  it("destroys the decoded document if metadata fails before a session can transfer", async () => {
    const destroy = vi.fn().mockResolvedValue(undefined);
    pdfjs.getDocument.mockReturnValue({
      promise: Promise.resolve({
        getMetadata: async () => {
          throw new Error("metadata");
        },
        destroy,
      }),
    });
    await expect(openPdf(new ArrayBuffer(0), "book.pdf")).rejects.toThrow(
      "metadata"
    );
    expect(destroy).toHaveBeenCalledTimes(1);
  });
});
