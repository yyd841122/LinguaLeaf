import { render, screen, within } from "@testing-library/react";
import { expect, it } from "vitest";
import { ReadingView, type Block } from "../src/ReadingView";

const blocks: Block[] = [
  {
    position: 1,
    kind: "sentence",
    originalText: "Mr. Gupta woke early.",
    ipaText: null,
    translationText: null,
  },
  { position: 2, kind: "code", originalText: "npm test -- --filter core" },
  {
    position: 3,
    kind: "raw",
    originalText: "Reading more: the official handbook. It is free.",
  },
];

it("renders each sentence as a three-line block with placeholder rows", () => {
  render(
    <ReadingView chapter={{ position: 2, title: "Chapter One: Red", blocks }} />
  );

  const reading = screen.getByRole("region", { name: "Chapter One: Red" });
  expect(
    within(reading).getByRole("heading", { name: "Chapter One: Red" })
  ).toBeVisible();

  const sentenceBlock = reading.querySelector(".sentence-block");
  expect(sentenceBlock).not.toBeNull();

  const lines = sentenceBlock?.querySelectorAll(
    ".original-line, .ipa-line, .translation-line"
  );
  expect(lines).toHaveLength(3);
  expect(lines?.[0]).toHaveTextContent("Mr. Gupta woke early.");
  // Annotation lines stay in the structure but empty until tickets 03/04 fill them.
  expect(lines?.[1]).toBeEmptyDOMElement();
  expect(lines?.[2]).toBeEmptyDOMElement();
});

it("shows code blocks and link paragraphs verbatim without sentence rows", () => {
  render(<ReadingView chapter={{ position: 4, title: "Interlude", blocks }} />);

  const reading = screen.getByRole("region", { name: "Interlude" });
  const code = reading.querySelector(".code-block");
  expect(code).toHaveTextContent("npm test -- --filter core");
  expect(code?.querySelector(".ipa-line")).toBeNull();

  const raw = reading.querySelector(".raw-block");
  expect(raw).toHaveTextContent(
    "Reading more: the official handbook. It is free."
  );
  expect(raw?.querySelector(".original-line")).toBeNull();
});
