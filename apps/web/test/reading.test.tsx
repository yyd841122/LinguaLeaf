import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { ReadingView, type Block } from "../src/ReadingView";

const blocks: Block[] = [
  {
    position: 1,
    kind: "sentence",
    originalText: "Mr. Gupta woke early.",
    ipaSlots: null,
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

it("renders a sentence without slots as original line, flat IPA line, translation line", () => {
  render(
    <ReadingView chapter={{ position: 2, title: "Chapter One: Red", blocks }} />
  );

  const sentenceBlock = screen
    .getByRole("region", { name: "Chapter One: Red" })
    .querySelector(".sentence-block");
  expect(sentenceBlock).not.toBeNull();

  const lines = sentenceBlock?.querySelectorAll(
    ".original-line, .ipa-line, .translation-line"
  );
  expect(lines).toHaveLength(3);
  expect(lines?.[0]).toHaveTextContent("Mr. Gupta woke early.");
  // Annotation lines stay in the structure but empty until the tickets fill them.
  expect(lines?.[1]).toBeEmptyDOMElement();
  expect(lines?.[2]).toBeEmptyDOMElement();
});

it("pairs each word with its IPA beneath it when slots are available", () => {
  const paired: Block[] = [
    {
      position: 1,
      kind: "sentence",
      originalText: "Mr. Gupta woke early.",
      ipaSlots: ["", "ˈɡʊptə", "ˈwoʊk", "ˈɝːli"],
      ipaText: "ˈɡʊptə ˈwoʊk ˈɝːli",
      translationText: null,
    },
  ];
  render(
    <ReadingView
      chapter={{ position: 2, title: "Chapter One: Red", blocks: paired }}
    />
  );

  const sentenceBlock = screen
    .getByRole("region", { name: "Chapter One: Red" })
    .querySelector(".sentence-block");
  expect(sentenceBlock).not.toBeNull();
  // The IPA travels with the words; no separate flat line anymore.
  expect(sentenceBlock?.querySelector(".ipa-line")).toBeNull();

  const units = sentenceBlock?.querySelectorAll(".ipa-word");
  expect(units).toHaveLength(3);
  const gupta = units?.[0];
  expect(gupta?.querySelector(".ipa-word-text")?.textContent).toBe("Gupta");
  expect(gupta?.querySelector(".ipa-word-ipa")?.textContent).toBe("ˈɡʊptə");
  expect(units?.[1]?.querySelector(".ipa-word-ipa")?.textContent).toBe("ˈwoʊk");
  expect(units?.[2]?.querySelector(".ipa-word-ipa")?.textContent).toBe("ˈɝːli");

  // A word without a transcription stays plain — no empty box next to it.
  expect(sentenceBlock?.querySelectorAll(".ipa-word-text")).toHaveLength(3);
  expect(sentenceBlock?.textContent).toContain("Mr.");

  // The translation row is untouched by the pairing.
  expect(sentenceBlock?.querySelector(".translation-line")).not.toBeNull();
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
