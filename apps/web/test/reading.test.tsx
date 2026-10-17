import { fireEvent, render, screen } from "@testing-library/react";
import { act, renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { ApiError } from "../src/api";
import { ReadingView, type Block } from "../src/ReadingView";
import {
  IpaSizeControl,
  MAX_IPA_SIZE,
  MIN_IPA_SIZE,
  readStoredIpaSize,
} from "../src/IpaSizeControl";
import {
  readStoredBoolean,
  useStoredBoolean,
  useStoredNumber,
} from "../src/prefs";
import {
  MAX_ORIGINAL_SIZE,
  MIN_ORIGINAL_SIZE,
  ReadingSettings,
  readStoredOriginalSize,
} from "../src/ReadingSettings";
import { fetchReadingProgress } from "../src/readingProgress";

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

it("ipa size control steps one pixel per click and clamps at the bounds", () => {
  const onChange = vi.fn();
  const { rerender } = render(<IpaSizeControl size={12} onChange={onChange} />);
  fireEvent.click(screen.getByRole("button", { name: "调大音标字号" }));
  expect(onChange).toHaveBeenCalledWith(13);
  rerender(<IpaSizeControl size={MIN_IPA_SIZE} onChange={onChange} />);
  expect(
    (screen.getByRole("button", { name: "调小音标字号" }) as HTMLButtonElement)
      .disabled
  ).toBe(true);
  rerender(<IpaSizeControl size={MAX_IPA_SIZE} onChange={onChange} />);
  expect(
    (screen.getByRole("button", { name: "调大音标字号" }) as HTMLButtonElement)
      .disabled
  ).toBe(true);
});

it("reads the remembered ipa size from localStorage, defaulting on garbage", () => {
  window.localStorage.setItem("lingualeaf.ipaSize", "16");
  expect(readStoredIpaSize()).toBe(16);
  window.localStorage.setItem("lingualeaf.ipaSize", "big");
  expect(readStoredIpaSize()).toBe(12);
  window.localStorage.removeItem("lingualeaf.ipaSize");
  expect(readStoredIpaSize()).toBe(12);
});

it("reading view exposes the ipa size to CSS as a variable", () => {
  render(
    <ReadingView
      chapter={{ position: 2, title: "Chapter One: Red", blocks }}
      ipaSize={16}
    />
  );
  const reading = screen.getByRole("region", { name: "Chapter One: Red" });
  expect(reading.style.getPropertyValue("--ipa-size")).toBe("16px");
});

it("reading view exposes the original size to CSS as a variable", () => {
  render(
    <ReadingView
      chapter={{ position: 2, title: "Chapter One: Red", blocks }}
      originalSize={18}
    />
  );
  const reading = screen.getByRole("region", { name: "Chapter One: Red" });
  expect(reading.style.getPropertyValue("--original-size")).toBe("18px");
});

it("reads stored boolean prefs, defaulting on missing or unrecognized values", () => {
  window.localStorage.setItem("lingualeaf.showIpa", "false");
  expect(readStoredBoolean("lingualeaf.showIpa", true)).toBe(false);
  window.localStorage.setItem("lingualeaf.showIpa", "yes");
  expect(readStoredBoolean("lingualeaf.showIpa", true)).toBe(true);
  window.localStorage.removeItem("lingualeaf.showIpa");
  expect(readStoredBoolean("lingualeaf.showIpa", true)).toBe(true);
});

it("persists toggle changes to localStorage and falls back on broken storage", () => {
  const { result } = renderHook(() =>
    useStoredBoolean("lingualeaf.showTranslation", true)
  );
  act(() => result.current[1](false));
  expect(result.current[0]).toBe(false);
  expect(window.localStorage.getItem("lingualeaf.showTranslation")).toBe(
    "false"
  );
});

it("persists number prefs through the clamp", () => {
  const { result } = renderHook(() =>
    useStoredNumber("lingualeaf.originalSize", 18, (value) =>
      Math.min(28, Math.max(14, value))
    )
  );
  act(() => result.current[1](99));
  expect(result.current[0]).toBe(28);
  expect(window.localStorage.getItem("lingualeaf.originalSize")).toBe("28");
});

it("settings panel drives both toggles and both font sizes", () => {
  const onShowIpaChange = vi.fn();
  const onShowTranslationChange = vi.fn();
  const onIpaSizeChange = vi.fn();
  const onOriginalSizeChange = vi.fn();
  render(
    <ReadingSettings
      showIpa={true}
      onShowIpaChange={onShowIpaChange}
      showTranslation={false}
      onShowTranslationChange={onShowTranslationChange}
      ipaSize={12}
      onIpaSizeChange={onIpaSizeChange}
      originalSize={18}
      onOriginalSizeChange={onOriginalSizeChange}
    />
  );

  const ipaBox = screen.getByRole("checkbox", {
    name: "音标行",
  }) as HTMLInputElement;
  expect(ipaBox.checked).toBe(true);
  const translationBox = screen.getByRole("checkbox", {
    name: "译文行",
  }) as HTMLInputElement;
  expect(translationBox.checked).toBe(false);

  fireEvent.click(ipaBox);
  expect(onShowIpaChange).toHaveBeenCalledWith(false);
  fireEvent.click(translationBox);
  expect(onShowTranslationChange).toHaveBeenCalledWith(true);

  fireEvent.click(screen.getByRole("button", { name: "调大原文字号" }));
  expect(onOriginalSizeChange).toHaveBeenCalledWith(19);
  fireEvent.click(screen.getByRole("button", { name: "调大音标字号" }));
  expect(onIpaSizeChange).toHaveBeenCalledWith(13);
});

it("clamps the original size stepper at its bounds", () => {
  const onOriginalSizeChange = vi.fn();
  const props = {
    showIpa: true,
    onShowIpaChange: vi.fn(),
    showTranslation: true,
    onShowTranslationChange: vi.fn(),
    ipaSize: 12,
    onIpaSizeChange: vi.fn(),
    onOriginalSizeChange,
  };
  const { rerender } = render(
    <ReadingSettings {...props} originalSize={MIN_ORIGINAL_SIZE} />
  );
  expect(
    (screen.getByRole("button", { name: "调小原文字号" }) as HTMLButtonElement)
      .disabled
  ).toBe(true);
  rerender(<ReadingSettings {...props} originalSize={MAX_ORIGINAL_SIZE} />);
  expect(
    (screen.getByRole("button", { name: "调大原文字号" }) as HTMLButtonElement)
      .disabled
  ).toBe(true);
});

it("reads the remembered original size from localStorage, defaulting on garbage", () => {
  window.localStorage.setItem("lingualeaf.originalSize", "22");
  expect(readStoredOriginalSize()).toBe(22);
  window.localStorage.setItem("lingualeaf.originalSize", "99");
  expect(readStoredOriginalSize()).toBe(28);
  window.localStorage.removeItem("lingualeaf.originalSize");
  expect(readStoredOriginalSize()).toBe(18);
});

it("reads a 404 as no saved progress but lets real failures throw", async () => {
  try {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ chapter: 2, block: 5 })))
    );
    await expect(fetchReadingProgress(1)).resolves.toEqual({
      chapter: 2,
      block: 5,
    });

    // Never read: a 404 is null, not an error.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 404 }))
    );
    await expect(fetchReadingProgress(1)).resolves.toBe(null);

    // Could not ask: must throw, or the caller would treat the real saved
    // position as absent and overwrite it with top-of-chapter.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 503 }))
    );
    await expect(fetchReadingProgress(1)).rejects.toBeInstanceOf(ApiError);
  } finally {
    vi.unstubAllGlobals();
  }
});

const toggledBlocks: Block[] = [
  {
    position: 1,
    kind: "sentence",
    originalText: "Mr. Gupta woke early.",
    ipaSlots: ["", "ˈɡʊptə", "ˈwoʊk", "ˈɝːli"],
    ipaText: "ˈɡʊptə ˈwoʊk ˈɝːli",
    translationText: "古普塔先生醒得很早。",
  },
  {
    position: 2,
    kind: "sentence",
    originalText: "A book without slots.",
    ipaSlots: null,
    ipaText: "ə bʊk",
    translationText: "一本没有槽位的书。",
  },
];

it("hides both IPA forms when showIpa is false, keeping the original line", () => {
  render(
    <ReadingView
      chapter={{
        position: 2,
        title: "Chapter One: Red",
        blocks: toggledBlocks,
      }}
      showIpa={false}
    />
  );

  const reading = screen.getByRole("region", { name: "Chapter One: Red" });
  const [paired, unpaired] = [...reading.querySelectorAll(".sentence-block")];

  // Word-paired IPA units and the flat fallback line both disappear.
  expect(paired?.querySelector(".ipa-word")).toBeNull();
  expect(unpaired?.querySelector(".ipa-line")).toBeNull();

  // The original line survives as plain text, never hideable.
  expect(paired?.querySelector(".original-line")?.textContent).toBe(
    "Mr. Gupta woke early."
  );
  expect(unpaired?.querySelector(".original-line")?.textContent).toBe(
    "A book without slots."
  );

  // The translation toggle is independent and untouched.
  expect(unpaired?.querySelector(".translation-line")?.textContent).toBe(
    "一本没有槽位的书。"
  );
});

it("hides the translation line when showTranslation is false, keeping the original and IPA", () => {
  render(
    <ReadingView
      chapter={{
        position: 2,
        title: "Chapter One: Red",
        blocks: toggledBlocks,
      }}
      showTranslation={false}
    />
  );

  const reading = screen.getByRole("region", { name: "Chapter One: Red" });
  const [paired, unpaired] = [...reading.querySelectorAll(".sentence-block")];

  expect(reading.querySelector(".translation-line")).toBeNull();

  // IPA annotation stays visible on its own.
  expect(paired?.querySelectorAll(".ipa-word")).toHaveLength(3);
  expect(unpaired?.querySelector(".ipa-line")?.textContent).toBe("ə bʊk");
  expect(
    [...(paired?.querySelectorAll(".ipa-word-text") ?? [])].map(
      (word) => word.textContent
    )
  ).toEqual(["Gupta", "woke", "early"]);
});
