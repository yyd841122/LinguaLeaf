import { describe, expect, it } from "vitest";
import { classifyPdfError, detectScanned } from "../src/reader/pdf";

describe("PDF ingestion classification (ticket 06)", () => {
  it("maps pdf.js native failures onto the shared rejection vocabulary", () => {
    const password = new Error("no password given");
    password.name = "PasswordException";
    expect(classifyPdfError(password)).toBe("encrypted-pdf");
    const broken = new Error("Invalid PDF structure");
    broken.name = "InvalidPDFException";
    expect(classifyPdfError(broken)).toBe("invalid-pdf");
    expect(classifyPdfError(new TypeError("something else"))).toBeNull();
  });

  it("a PDF whose first pages carry no text is scanned", () => {
    expect(detectScanned([0, 0, 0])).toBe(true);
    expect(detectScanned([2])).toBe(true);
    expect(detectScanned([])).toBe(true);
  });

  it("one blank cover page does not condemn a real book", () => {
    // The average over the sampled pages decides: a text-less cover in
    // front of real chapters stays readable.
    expect(detectScanned([0, 842, 903])).toBe(false);
    expect(detectScanned([1200, 1100])).toBe(false);
  });
});
