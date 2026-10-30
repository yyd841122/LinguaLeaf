// Fixtures and helper types are describe-local in this file: each describe
// declares its own stubs and payload constants (chapterBlocks / Call /
// ChapterPayload in the translate describe, untranslatedBlocks in ticket
// 03's). Append new tests INSIDE the describe whose fixtures you need — a
// file-tail append lands in the last describe and misses them.
import { fireEvent, render, screen } from "@testing-library/react";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";
import { ApiError, fetchJson } from "../src/api";
import type {
  ChapterPayload,
  ChapterTranslationState,
} from "../../server/src/wire";
import { ReadingPage } from "../src/ReadingPage";
import { ReadingView, type Block } from "../src/ReadingView";
import {
  IpaSizeControl,
  MAX_IPA_SIZE,
  MIN_IPA_SIZE,
  readStoredIpaSize,
} from "../src/IpaSizeControl";
import {
  readStoredBookBoolean,
  readStoredBookNumber,
  useStoredBookBoolean,
  useStoredBookNumber,
} from "../src/prefs";
import {
  MAX_ORIGINAL_SIZE,
  MAX_TRANSLATION_SIZE,
  MIN_ORIGINAL_SIZE,
  MIN_TRANSLATION_SIZE,
  ReadingSettings,
  readStoredOriginalSize,
  readStoredTranslationSize,
} from "../src/ReadingSettings";
import { fetchReadingProgress } from "../src/readingProgress";
import { dataWordEl, dataWordEls } from "./domQueries";

const blocks: Block[] = [
  {
    position: 1,
    kind: "sentence",
    originalText: "Mr. Gupta woke early.",
    ipaSlots: null,
    ipaText: null,
    translationText: null,
    wordStatuses: [null, null, null, null],
  },
  { position: 2, kind: "code", originalText: "npm test -- --filter core" },
  {
    position: 3,
    kind: "raw",
    originalText: "Reading more: the official handbook. It is free.",
  },
];

// The ReadingPage harness shared by the component-boundary describes
// below: the page mounted at /book/7/2 through the real router.
function renderReadingPage() {
  return render(
    <MemoryRouter initialEntries={["/book/7/2"]}>
      <Routes>
        <Route path="/book/:id/:chapter" element={<ReadingPage />} />
      </Routes>
    </MemoryRouter>
  );
}

// The annotation toggles persist across tests; tests that assert on the
// rendered lines start from the visible defaults. The harness's book is 7:
// both its per-book keys and the legacy fallback keys (which would
// silently re-seed book 7 through the one-time migration) start cleared.
function clearAnnotationToggles() {
  window.localStorage.removeItem("book:7:showIpa");
  window.localStorage.removeItem("book:7:showTranslation");
  window.localStorage.removeItem("lingualeaf.showIpa");
  window.localStorage.removeItem("lingualeaf.showTranslation");
}

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
      wordStatuses: [null, null, null, null],
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
  // The transcription is a data attribute (::before renders it), not a
  // text child — selecting the original never picks it up.
  expect(gupta?.querySelector(".ipa-word-ipa")?.getAttribute("data-ipa")).toBe(
    "ˈɡʊptə"
  );
  expect(
    units?.[1]?.querySelector(".ipa-word-ipa")?.getAttribute("data-ipa")
  ).toBe("ˈwoʊk");
  expect(
    units?.[2]?.querySelector(".ipa-word-ipa")?.getAttribute("data-ipa")
  ).toBe("ˈɝːli");

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

it("renders an image block as a placeholder in its reading position", () => {
  render(
    <ReadingView
      chapter={{
        position: 2,
        title: "Chapter One: Pictures",
        blocks: [
          {
            position: 1,
            kind: "sentence",
            originalText: "A picture sits between two sentences.",
            ipaSlots: null,
            ipaText: null,
            translationText: null,
            wordStatuses: [null, null, null, null, null, null],
          },
          { position: 2, kind: "image", originalText: "A red dot" },
          {
            position: 3,
            kind: "sentence",
            originalText: "The story continues after the picture.",
            ipaSlots: null,
            ipaText: null,
            translationText: null,
            wordStatuses: [null, null, null, null, null, null],
          },
        ],
      }}
    />
  );

  const children = screen
    .getByRole("region", { name: "Chapter One: Pictures" })
    .querySelectorAll(".blocks > *");
  expect(children).toHaveLength(3);
  const image = children[1];
  expect(image).toHaveClass("image-block");
  // The alt text is the placeholder's caption; no annotation lines exist.
  expect(image).toHaveTextContent("A red dot");
  expect(image?.querySelector(".original-line, .ipa-line")).toBeNull();
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

it("reads the remembered ipa size per book, legacy fallback, defaulting on garbage", () => {
  window.localStorage.setItem("book:41:ipaSize", "16");
  expect(readStoredIpaSize(41)).toBe(16);
  window.localStorage.setItem("book:41:ipaSize", "big");
  expect(readStoredIpaSize(41)).toBe(12);
  // A book never opened since the migration reads the global-era key.
  window.localStorage.removeItem("book:41:ipaSize");
  window.localStorage.setItem("lingualeaf.ipaSize", "14");
  expect(readStoredIpaSize(41)).toBe(14);
  window.localStorage.removeItem("lingualeaf.ipaSize");
  expect(readStoredIpaSize(41)).toBe(12);
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

it("reading view exposes the translation size to CSS as a variable", () => {
  render(
    <ReadingView
      chapter={{ position: 2, title: "Chapter One: Red", blocks }}
      translationSize={16}
    />
  );
  const reading = screen.getByRole("region", { name: "Chapter One: Red" });
  expect(reading.style.getPropertyValue("--translation-size")).toBe("16px");
});

// Per-book pref readers (per-book-toggles ticket 01): every preference
// lives on `book:<id>:<pref>`; the pre-per-book global keys
// (`lingualeaf.<pref>`) are a read-only one-time fallback. Book ids 3/4
// keep these tests out of the ReadingPage harness's book 7.
describe("per-book pref readers (ticket per-book-toggles 01)", () => {
  beforeEach(() => {
    for (const key of [
      "book:3:showIpa",
      "book:3:originalSize",
      "lingualeaf.showIpa",
      "lingualeaf.originalSize",
    ]) {
      window.localStorage.removeItem(key);
    }
  });

  it("reads the book-scoped key, which wins over a disagreeing legacy key", () => {
    window.localStorage.setItem("book:3:showIpa", "true");
    window.localStorage.setItem("lingualeaf.showIpa", "false");
    expect(readStoredBookBoolean(3, "showIpa", false)).toBe(true);

    window.localStorage.setItem("book:3:originalSize", "20");
    window.localStorage.setItem("lingualeaf.originalSize", "16");
    expect(
      readStoredBookNumber(3, "originalSize", 18, (value) =>
        Math.min(28, Math.max(14, value))
      )
    ).toBe(20);
  });

  it("falls back to the legacy global key when the book key is missing", () => {
    window.localStorage.setItem("lingualeaf.showIpa", "false");
    expect(readStoredBookBoolean(3, "showIpa", true)).toBe(false);

    window.localStorage.setItem("lingualeaf.originalSize", "22");
    expect(
      readStoredBookNumber(3, "originalSize", 18, (value) =>
        Math.min(28, Math.max(14, value))
      )
    ).toBe(22);
  });

  it("clamps a legacy fallback value the same as a book-key value", () => {
    window.localStorage.setItem("lingualeaf.originalSize", "99");
    expect(
      readStoredBookNumber(3, "originalSize", 18, (value) =>
        Math.min(28, Math.max(14, value))
      )
    ).toBe(28);
  });

  it("defaults when neither the book key nor the legacy key exists", () => {
    expect(readStoredBookBoolean(3, "showIpa", true)).toBe(true);
    expect(
      readStoredBookNumber(3, "originalSize", 18, (value) =>
        Math.min(28, Math.max(14, value))
      )
    ).toBe(18);
  });

  it("does not fall back to the legacy key when the book key holds garbage", () => {
    // A present book key means this book already has its own value; the
    // legacy key only speaks for books never opened since the migration.
    window.localStorage.setItem("book:3:showIpa", "yes");
    window.localStorage.setItem("lingualeaf.showIpa", "false");
    expect(readStoredBookBoolean(3, "showIpa", true)).toBe(true);

    window.localStorage.setItem("book:3:originalSize", "junk");
    window.localStorage.setItem("lingualeaf.originalSize", "22");
    expect(
      readStoredBookNumber(3, "originalSize", 18, (value) =>
        Math.min(28, Math.max(14, value))
      )
    ).toBe(18);
  });

  it("treats an invalid book id as no preference at all", () => {
    expect(readStoredBookBoolean(Number.NaN, "showIpa", true)).toBe(true);
    expect(
      readStoredBookNumber(Number.NaN, "originalSize", 18, (value) =>
        Math.min(28, Math.max(14, value))
      )
    ).toBe(18);
  });

  it("degrades to the default when localStorage itself is broken", () => {
    // The 守护门禁: private browsing / blocked storage degrades to the
    // default, it never breaks rendering.
    const broken = vi
      .spyOn(window.localStorage, "getItem")
      .mockImplementation(() => {
        throw new Error("storage blocked");
      });
    try {
      expect(readStoredBookBoolean(3, "showIpa", true)).toBe(true);
      expect(readStoredBookNumber(3, "originalSize", 18)).toBe(18);
    } finally {
      broken.mockRestore();
    }
  });
});

// The book hooks (same ticket): persistence lands on the book key, the
// legacy key stays read-only, and a mounted hook follows a book-id change
// (the useState initializer runs once per mount — shelf → another book
// must not keep the previous book's values).
describe("per-book pref hooks (ticket per-book-toggles 01)", () => {
  beforeEach(() => {
    for (const key of [
      "book:3:showIpa",
      "book:3:originalSize",
      "book:4:showIpa",
      "lingualeaf.showIpa",
      "lingualeaf.originalSize",
    ]) {
      window.localStorage.removeItem(key);
    }
  });

  it("persists through the clamp to the book key and never writes the legacy key", () => {
    window.localStorage.setItem("lingualeaf.originalSize", "16");
    const { result } = renderHook(() =>
      useStoredBookNumber(3, "originalSize", 18, (value) =>
        Math.min(28, Math.max(14, value))
      )
    );
    // The legacy value speaks until this book has one of its own.
    expect(result.current[0]).toBe(16);
    act(() => result.current[1](99));
    expect(result.current[0]).toBe(28);
    expect(window.localStorage.getItem("book:3:originalSize")).toBe("28");
    expect(window.localStorage.getItem("lingualeaf.originalSize")).toBe("16");
  });

  it("materializes the book key from the legacy fallback on mount", () => {
    window.localStorage.setItem("lingualeaf.showIpa", "false");
    const { result } = renderHook(() =>
      useStoredBookBoolean(3, "showIpa", true)
    );
    expect(result.current[0]).toBe(false);
    expect(window.localStorage.getItem("book:3:showIpa")).toBe("false");
    // The legacy key is read-only, even as its value moves over.
    expect(window.localStorage.getItem("lingualeaf.showIpa")).toBe("false");
  });

  it("follows the book when the book id changes under a mounted hook", () => {
    window.localStorage.setItem("book:3:showIpa", "false");
    const { result, rerender } = renderHook(
      ({ bookId }: { bookId: number }) =>
        useStoredBookBoolean(bookId, "showIpa", true),
      { initialProps: { bookId: 3 } }
    );
    expect(result.current[0]).toBe(false);
    rerender({ bookId: 4 });
    expect(result.current[0]).toBe(true); // book 4 has no value yet: default
    act(() => result.current[1](false));
    expect(window.localStorage.getItem("book:4:showIpa")).toBe("false");
    rerender({ bookId: 3 });
    expect(result.current[0]).toBe(false); // book 3's own value again
  });

  it("persists nothing for an invalid book id", () => {
    const { result } = renderHook(() =>
      useStoredBookBoolean(Number.NaN, "showIpa", true)
    );
    act(() => result.current[1](false));
    expect(result.current[0]).toBe(false); // the toggle still works in-session
    expect(window.localStorage.getItem("book:NaN:showIpa")).toBeNull();
  });

  it("swallows the write when localStorage itself is broken", () => {
    const broken = vi
      .spyOn(window.localStorage, "setItem")
      .mockImplementation(() => {
        throw new Error("storage blocked");
      });
    try {
      const { result } = renderHook(() =>
        useStoredBookBoolean(3, "showIpa", true)
      );
      act(() => result.current[1](false));
      expect(result.current[0]).toBe(false); // in-session state still flips
    } finally {
      broken.mockRestore();
    }
  });
});

it("settings panel drives both toggles and both font sizes", () => {
  const onShowIpaChange = vi.fn();
  const onShowTranslationChange = vi.fn();
  const onIpaSizeChange = vi.fn();
  const onOriginalSizeChange = vi.fn();
  const onTranslationSizeChange = vi.fn();
  render(
    <ReadingSettings
      showIpa={true}
      onShowIpaChange={onShowIpaChange}
      showTranslation={false}
      onShowTranslationChange={onShowTranslationChange}
      translationLinesAvailable={true}
      ipaSize={12}
      onIpaSizeChange={onIpaSizeChange}
      originalSize={18}
      onOriginalSizeChange={onOriginalSizeChange}
      translationSize={14}
      onTranslationSizeChange={onTranslationSizeChange}
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
  fireEvent.click(screen.getByRole("button", { name: "调大译文字号" }));
  expect(onTranslationSizeChange).toHaveBeenCalledWith(15);
});

it("grays the 译文行 toggle when the chapter has no translation lines", () => {
  // Ticket 03: a wholly untranslated chapter has no line to show and no
  // toggle to offer; the 音标行 toggle is untouched.
  render(
    <ReadingSettings
      showIpa={true}
      onShowIpaChange={vi.fn()}
      showTranslation={true}
      onShowTranslationChange={vi.fn()}
      translationLinesAvailable={false}
      ipaSize={12}
      onIpaSizeChange={vi.fn()}
      originalSize={18}
      onOriginalSizeChange={vi.fn()}
      translationSize={14}
      onTranslationSizeChange={vi.fn()}
    />
  );

  const translationBox = screen.getByRole("checkbox", {
    name: "译文行",
  }) as HTMLInputElement;
  expect(translationBox.disabled).toBe(true);
  const ipaBox = screen.getByRole("checkbox", {
    name: "音标行",
  }) as HTMLInputElement;
  expect(ipaBox.disabled).toBe(false);
});

it("clamps the original and translation size steppers at their bounds", () => {
  const onOriginalSizeChange = vi.fn();
  const onTranslationSizeChange = vi.fn();
  const props = {
    showIpa: true,
    onShowIpaChange: vi.fn(),
    showTranslation: true,
    onShowTranslationChange: vi.fn(),
    translationLinesAvailable: true,
    ipaSize: 12,
    onIpaSizeChange: vi.fn(),
    onOriginalSizeChange,
    onTranslationSizeChange,
  };
  const { rerender } = render(
    <ReadingSettings
      {...props}
      originalSize={MIN_ORIGINAL_SIZE}
      translationSize={MIN_TRANSLATION_SIZE}
    />
  );
  expect(
    (screen.getByRole("button", { name: "调小原文字号" }) as HTMLButtonElement)
      .disabled
  ).toBe(true);
  expect(
    (screen.getByRole("button", { name: "调小译文字号" }) as HTMLButtonElement)
      .disabled
  ).toBe(true);
  rerender(
    <ReadingSettings
      {...props}
      originalSize={MAX_ORIGINAL_SIZE}
      translationSize={MAX_TRANSLATION_SIZE}
    />
  );
  expect(
    (screen.getByRole("button", { name: "调大原文字号" }) as HTMLButtonElement)
      .disabled
  ).toBe(true);
  expect(
    (screen.getByRole("button", { name: "调大译文字号" }) as HTMLButtonElement)
      .disabled
  ).toBe(true);
});

it("reads the remembered original size per book, legacy fallback, defaulting on garbage", () => {
  window.localStorage.setItem("book:42:originalSize", "22");
  expect(readStoredOriginalSize(42)).toBe(22);
  window.localStorage.setItem("book:42:originalSize", "99");
  expect(readStoredOriginalSize(42)).toBe(28);
  window.localStorage.removeItem("book:42:originalSize");
  window.localStorage.setItem("lingualeaf.originalSize", "20");
  expect(readStoredOriginalSize(42)).toBe(20);
  window.localStorage.removeItem("lingualeaf.originalSize");
  expect(readStoredOriginalSize(42)).toBe(18);
});

it("reads the remembered translation size per book, legacy fallback, defaulting on garbage", () => {
  window.localStorage.setItem("book:43:translationSize", "18");
  expect(readStoredTranslationSize(43)).toBe(18);
  window.localStorage.setItem("book:43:translationSize", "big");
  expect(readStoredTranslationSize(43)).toBe(14);
  window.localStorage.removeItem("book:43:translationSize");
  window.localStorage.setItem("lingualeaf.translationSize", "16");
  expect(readStoredTranslationSize(43)).toBe(16);
  window.localStorage.removeItem("lingualeaf.translationSize");
  expect(readStoredTranslationSize(43)).toBe(14);
});

it("parses a bodyless 204 as success instead of a failure", async () => {
  try {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 204 }))
    );
    // Book deletion returns 204 No Content. Parsing its (empty) body as
    // JSON throws and made the bookshelf report 删除失败 for a delete that
    // actually succeeded.
    await expect(
      fetchJson("/api/books/1", { method: "DELETE" })
    ).resolves.toBeUndefined();
  } finally {
    vi.unstubAllGlobals();
  }
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
    wordStatuses: [null, null, null, null],
  },
  {
    position: 2,
    kind: "sentence",
    originalText: "A book without slots.",
    ipaSlots: null,
    ipaText: "ə bʊk",
    translationText: "一本没有槽位的书。",
    wordStatuses: [null, null, null, null],
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

describe("ReadingPage through the component boundary", () => {
  // The progress tests above exercise the fetch helper alone; these render
  // the real page, so restoration, the debounced save, the unmount flush,
  // and the save-failure notice run through the actual component (audit
  // 2026-10-23 — none of those lifecycle boundaries had a component test).
  const chapterBlocks: Block[] = [1, 2, 3].map((position) => ({
    position,
    kind: "sentence" as const,
    originalText: `Sentence ${position} stands here.`,
    ipaSlots: null,
    ipaText: null,
    translationText: null,
    wordStatuses: [null, null, null, null, null],
  }));

  type Call = { url: string; init: RequestInit };
  function stubBookFetch(putBehavior: "ok" | "fail"): { calls: Call[] } {
    const calls: Call[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown, init?: RequestInit) => {
        const url = String(input);
        calls.push({ url, init: init ?? {} });
        if (url.endsWith("/progress") && init?.method === "PUT") {
          return putBehavior === "fail"
            ? new Response(null, { status: 503 })
            : new Response(null, { status: 204 });
        }
        if (url.endsWith("/chapters/2")) {
          return new Response(
            JSON.stringify({
              position: 2,
              title: "Chapter Two",
              translationStatus: "untranslated",
              translationPercent: null,
              translationError: null,
              translationAvailable: true,
              blocks: chapterBlocks,
            })
          );
        }
        if (url.endsWith("/progress")) {
          // A position in another chapter: the page must not jump, and the
          // chapter-start autosave is the first write.
          return new Response(JSON.stringify({ chapter: 1, block: 2 }));
        }
        if (url.endsWith("/api/books/7")) {
          return new Response(
            JSON.stringify({
              id: 7,
              title: "Probe Book",
              chapters: [
                { position: 1, title: "One", level: 1 },
                { position: 2, title: "Two", level: 2 },
              ],
            })
          );
        }
        return new Response(null, { status: 404 });
      })
    );
    return { calls };
  }

  it("withdraws the tint from all surface and lemma matches immediately after a popup save", async () => {
    const chapter: ChapterPayload = {
      position: 2,
      title: "Chapter Two",
      level: null,
      translationStatus: "untranslated",
      translationPercent: null,
      translationError: null,
      translationAvailable: true,
      blocks: [
        {
          position: 1,
          kind: "sentence",
          originalText: "Mr. Gupta woke early.",
          ipaSlots: ["", "ˈɡʊptə", "ˈwoʊk", "ˈɝːli"],
          ipaText: "ˈɡʊptə ˈwoʊk ˈɝːli",
          translationText: null,
          wordStatuses: [null, null, null, "ignored"],
        },
        { position: 2, kind: "code", originalText: "wake woke" },
        {
          position: 3,
          kind: "sentence",
          originalText: "They woke, wake waking Woke.",
          ipaSlots: null,
          ipaText: null,
          translationText: null,
          wordStatuses: [null, "learning", null, "learning", null],
        },
        { position: 4, kind: "image", originalText: "woke" },
        { position: 5, kind: "raw", originalText: "wake" },
      ],
    };
    const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/lookup/woke")) {
        return new Response(
          JSON.stringify({
            word: "woke",
            lemma: "wake",
            ipa: "ˈwoʊk",
            pos: "v.",
            translation: "v. 醒来, 唤醒",
            status: "learning",
          })
        );
      }
      if (url.endsWith("/api/vocab/lemmas/wake") && init?.method === "PUT") {
        return new Response(JSON.stringify({ lemma: "wake", status: "known" }));
      }
      if (url.endsWith("/chapters/2")) {
        return new Response(JSON.stringify(chapter));
      }
      if (url.endsWith("/progress")) {
        return init?.method === "PUT"
          ? new Response(null, { status: 204 })
          : new Response(JSON.stringify({ chapter: 1, block: 2 }));
      }
      if (url.endsWith("/api/books/7")) {
        return new Response(
          JSON.stringify({
            id: 7,
            title: "Probe Book",
            chapters: [{ position: 2, title: "Two", level: 1 }],
          })
        );
      }
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      clearAnnotationToggles();
      window.HTMLElement.prototype.scrollIntoView = vi.fn();
      const view = renderReadingPage();
      const reading = await screen.findByRole("region", {
        name: "Chapter Two",
      });
      const matches = dataWordEls(reading).filter((el) => {
        const name = el.getAttribute("data-word");
        return name === "woke" || name === "wake";
      });
      expect(matches).toHaveLength(3);
      for (const word of matches) {
        expect(word).not.toHaveClass("word-settled");
      }
      fireEvent.click(matches[0]!);
      await screen.findByText("词元 wake");
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "已掌握" }));
      });
      for (const word of matches) {
        expect(word).toHaveClass("word-settled");
      }
      // Exact strings only (spec decision 2): other inflections and case
      // variants keep their existing affordance, as do unrelated words.
      for (const word of ["waking", "Woke", "Gupta"]) {
        expect(dataWordEl(reading, word)).not.toHaveClass("word-settled");
      }
      expect(dataWordEl(reading, "early")).toHaveClass("word-settled");
      expect(
        fetchMock.mock.calls.filter(([url]) =>
          String(url).endsWith("/chapters/2")
        )
      ).toHaveLength(1);
      view.unmount();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("jumps to the saved block of this chapter on open", async () => {
    const jump = vi.fn();
    window.HTMLElement.prototype.scrollIntoView = jump;
    // Saved block 3 belongs to THIS chapter: the restore path runs.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) => {
        const url = String(input);
        if (url.endsWith("/chapters/2")) {
          return new Response(
            JSON.stringify({
              position: 2,
              title: "Chapter Two",
              translationStatus: "untranslated",
              translationPercent: null,
              translationError: null,
              translationAvailable: true,
              blocks: chapterBlocks,
            })
          );
        }
        if (url.endsWith("/progress")) {
          return new Response(JSON.stringify({ chapter: 2, block: 3 }));
        }
        if (url.endsWith("/api/books/7")) {
          return new Response(
            JSON.stringify({
              id: 7,
              title: "Probe Book",
              chapters: [{ position: 2, title: "Two", level: 2 }],
            })
          );
        }
        return new Response(null, { status: 404 });
      })
    );
    renderReadingPage();
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText("Chapter Two")).toBeTruthy();
    expect(jump).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("autosaves the chapter start through the debounce and flushes on unmount", async () => {
    vi.useFakeTimers();
    try {
      window.HTMLElement.prototype.scrollIntoView = vi.fn();
      const { calls } = stubBookFetch("ok");
      const view = renderReadingPage();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(screen.getByText("Chapter Two")).toBeTruthy();

      // Unmount while the chapter-start save is still pending (debounce not
      // elapsed): the flush must carry the position out with the page
      // (audit 2026-10-23, verification round — the old order unmounted
      // after the save had already landed, proving nothing).
      act(() => {
        view.unmount();
      });
      const puts = calls.filter(
        (call) => call.url.endsWith("/progress") && call.init.method === "PUT"
      );
      expect(puts).toHaveLength(1);
      expect(JSON.parse(String(puts[0]!.init.body))).toEqual({
        chapter: 2,
        block: 1,
      });
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });

  it("shows the save-failed notice when a save does not land", async () => {
    vi.useFakeTimers();
    try {
      window.HTMLElement.prototype.scrollIntoView = vi.fn();
      stubBookFetch("fail");
      renderReadingPage();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });
      // The reader sees that the sync is not happening (CODING_STANDARDS:
      // a retry loop's last state must not outlive its credibility).
      expect(
        screen.getByText(/阅读进度保存失败，位置可能没有同步。/)
      ).toBeTruthy();
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });
});

// The on-demand translation button (on-demand-translation ticket 01): the
// toolbar's third button keys its three shapes on the chapter payload's
// translationStatus, the trigger POST patches the state in from the 202
// body, and the 1.5s poll follows the lifecycle until the chapter settles.
describe("ReadingPage's translate button through the component boundary", () => {
  const chapterBlocks: Block[] = [
    {
      position: 1,
      kind: "sentence",
      originalText: "Mr. Gupta woke early.",
      ipaSlots: null,
      ipaText: null,
      translationText: null,
      wordStatuses: [null, null, null, null],
    },
  ];

  // Earlier tests in this file persist both toggles as false; these assert
  // on the rendered lines, so each starts from the visible defaults.
  beforeEach(clearAnnotationToggles);

  // The three state fields mirror the real chapter payload's shape (the
  // stub stubs the wire, not a subset of it).
  // The stub payloads compile against the wire's own state shape (one
  // source with the server), so the next payload field turns every
  // un-migrated stub literal into a compile error instead of a review
  // round (retro 2026-10-24).
  type ChapterPayload = ChapterTranslationState & {
    blocks?: Block[];
  };
  type Call = { url: string; init: RequestInit };

  // The scripted server: the chapter answers with each payload in order
  // (staying on the last one), the trigger POST answers with `postBody`,
  // and `pollBehavior` fails the poll GETs when set.
  function stubTranslateFetch(options: {
    chapterPayloads: ChapterPayload[];
    postBody: ChapterPayload;
    postResponse?: () => Promise<Response>;
    pollBehavior?: "fail";
  }): { calls: Call[] } {
    const calls: Call[] = [];
    let payloadIndex = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown, init?: RequestInit) => {
        const url = String(input);
        calls.push({ url, init: init ?? {} });
        if (url.endsWith("/chapters/2/translate")) {
          if (options.postResponse) return options.postResponse();
          return new Response(JSON.stringify(options.postBody), {
            status: 202,
          });
        }
        if (url.endsWith("/chapters/2")) {
          if (options.pollBehavior === "fail") {
            return new Response(null, { status: 503 });
          }
          const payload =
            options.chapterPayloads[
              Math.min(payloadIndex, options.chapterPayloads.length - 1)
            ];
          payloadIndex += 1;
          return new Response(JSON.stringify(payload));
        }
        if (url.endsWith("/progress")) {
          return new Response(JSON.stringify({ chapter: 2, block: 1 }));
        }
        if (url.endsWith("/api/books/7")) {
          return new Response(
            JSON.stringify({
              id: 7,
              title: "Probe Book",
              chapters: [{ position: 2, title: "Two", level: 2 }],
            })
          );
        }
        return new Response(null, { status: 404 });
      })
    );
    return { calls };
  }

  it("offers 翻译 on an untranslated chapter, then polls to 已翻译 with fresh lines", async () => {
    vi.useFakeTimers();
    try {
      window.HTMLElement.prototype.scrollIntoView = vi.fn();
      const translating: ChapterPayload = {
        translationStatus: "translating",
        translationPercent: 44,
        translationError: null,
        translationAvailable: true,
      };
      const translated: ChapterPayload = {
        translationStatus: "translated",
        translationPercent: null,
        translationError: null,
        translationAvailable: true,
        blocks: [
          {
            position: 1,
            kind: "sentence",
            originalText: "Mr. Gupta woke early.",
            ipaSlots: null,
            ipaText: null,
            translationText: "古普塔先生醒得很早。",
            wordStatuses: [null, null, null, null],
          },
        ],
      };
      const { calls } = stubTranslateFetch({
        chapterPayloads: [
          {
            translationStatus: "untranslated",
            translationPercent: null,
            translationError: null,
            translationAvailable: true,
            blocks: chapterBlocks,
          },
          { ...translating, blocks: chapterBlocks },
          translated,
        ],
        postBody: {
          translationStatus: "translating",
          translationPercent: 0,
          translationError: null,
          translationAvailable: true,
        },
      });
      renderReadingPage();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      // State one: the chapter has no translation yet.
      const button = screen.getByRole("button", { name: "翻译" });
      expect(button).toBeTruthy();

      fireEvent.click(button);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      // The 202 body moves the button into its translating shape before
      // the first poll; the POST rode the same client path the contract
      // suite pins.
      expect(screen.getByRole("button", { name: "翻译中 0%" })).toBeTruthy();
      expect(
        (screen.getByRole("button", { name: "翻译中 0%" }) as HTMLButtonElement)
          .disabled
      ).toBe(true);
      expect(
        calls.filter((call) => call.url.endsWith("/translate"))
      ).toHaveLength(1);

      // Poll one: the percent moved.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1500);
      });
      expect(screen.getByRole("button", { name: "翻译中 44%" })).toBeTruthy();

      // Poll two: the chapter settled — the fresh translation line rides
      // the same response. The button is back as 已翻译 but disabled:
      // translated chapters don't re-translate.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1500);
      });
      const again = screen.getByRole("button", { name: "已翻译" });
      expect(again).toBeTruthy();
      expect((again as HTMLButtonElement).disabled).toBe(true);
      expect(screen.getByText("古普塔先生醒得很早。")).toBeTruthy();
      // The poll stops with the lifecycle: no further chapter GETs.
      const chapterGets = calls.filter(
        (call) =>
          call.url.endsWith("/chapters/2") && call.init.method === undefined
      );
      const getsAfterSettle = chapterGets.length;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(4500);
      });
      expect(
        calls.filter(
          (call) =>
            call.url.endsWith("/chapters/2") && call.init.method === undefined
        )
      ).toHaveLength(getsAfterSettle);
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });

  it("shows 已翻译 on a translated chapter and disables the button while the payload says translating", async () => {
    vi.useFakeTimers();
    try {
      window.HTMLElement.prototype.scrollIntoView = vi.fn();
      stubTranslateFetch({
        chapterPayloads: [
          {
            translationStatus: "translating",
            translationPercent: 7,
            translationError: null,
            translationAvailable: true,
            blocks: chapterBlocks,
          },
        ],
        postBody: {
          translationStatus: "translating",
          translationPercent: 7,
          translationError: null,
          translationAvailable: true,
        },
      });
      renderReadingPage();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      // Opening a chapter that is already translating (another tab started
      // it) shows the disabled progress shape straight from the payload.
      const button = screen.getByRole("button", {
        name: "翻译中 7%",
      }) as HTMLButtonElement;
      expect(button.disabled).toBe(true);
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });

  it("surfaces a persistently failing poll and clears the notice when a tick lands", async () => {
    vi.useFakeTimers();
    try {
      window.HTMLElement.prototype.scrollIntoView = vi.fn();
      // The initial load answers; only the poll ticks that follow fail
      // until the test lets one land.
      let chapterGets = 0;
      const calls: Call[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: unknown, init?: RequestInit) => {
          const url = String(input);
          calls.push({ url, init: init ?? {} });
          if (url.endsWith("/chapters/2")) {
            chapterGets += 1;
            if (chapterGets === 1) {
              return new Response(
                JSON.stringify({
                  translationStatus: "translating",
                  translationPercent: 30,
                  translationError: null,
                  translationAvailable: true,
                  blocks: chapterBlocks,
                })
              );
            }
            if (chapterGets < 4) return new Response(null, { status: 503 });
            return new Response(
              JSON.stringify({
                translationStatus: "translated",
                translationPercent: null,
                translationError: null,
                translationAvailable: true,
                blocks: chapterBlocks,
              })
            );
          }
          if (url.endsWith("/progress")) {
            return new Response(JSON.stringify({ chapter: 2, block: 1 }));
          }
          if (url.endsWith("/api/books/7")) {
            return new Response(
              JSON.stringify({
                id: 7,
                title: "Probe Book",
                chapters: [{ position: 2, title: "Two", level: 2 }],
              })
            );
          }
          return new Response(null, { status: 404 });
        })
      );
      renderReadingPage();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      // Already translating at load; the poll's next ticks all fail.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
      expect(
        screen.getByText(/无法连接服务端，翻译进度可能已过期/)
      ).toBeTruthy();
      // A landing tick clears the notice — the loop recovered.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1500);
      });
      expect(
        screen.queryByText(/无法连接服务端，翻译进度可能已过期/)
      ).toBeNull();
      expect(screen.getByRole("button", { name: "已翻译" })).toBeTruthy();
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });

  it("displays a failed chapter's reason and retries to fresh translation lines", async () => {
    vi.useFakeTimers();
    try {
      window.HTMLElement.prototype.scrollIntoView = vi.fn();
      const reason = "服务重启，章节翻译中断，请重新翻译";
      const { calls } = stubTranslateFetch({
        chapterPayloads: [
          {
            translationStatus: "failed",
            translationPercent: null,
            translationError: reason,
            translationAvailable: true,
            blocks: chapterBlocks,
          },
          {
            translationStatus: "translated",
            translationPercent: null,
            translationError: null,
            translationAvailable: true,
            blocks: [
              {
                position: 1,
                kind: "sentence",
                originalText: "Mr. Gupta woke early.",
                ipaSlots: null,
                ipaText: null,
                translationText: "古普塔先生醒得很早。",
                wordStatuses: [null, null, null, null],
              },
            ],
          },
        ],
        postBody: {
          translationStatus: "translating",
          translationPercent: 0,
          translationError: null,
          translationAvailable: true,
        },
      });
      renderReadingPage();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(screen.getByRole("alert").textContent).toBe(reason);
      // A failed chapter has no translation: the button reads 翻译 and
      // stays the recovery path.
      const retry = screen.getByRole("button", { name: "翻译" });
      expect((retry as HTMLButtonElement).disabled).toBe(false);
      fireEvent.click(retry);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(calls.filter((call) => call.init.method === "POST")).toHaveLength(
        1
      );
      expect(screen.queryByText(reason)).toBeNull();
      expect(screen.getByRole("button", { name: "翻译中 0%" })).toBeTruthy();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1500);
      });
      expect(screen.getByText("古普塔先生醒得很早。")).toBeTruthy();
      const settled = screen.getByRole("button", {
        name: "已翻译",
      }) as HTMLButtonElement;
      expect(settled.disabled).toBe(true);
      expect(screen.queryByRole("alert")).toBeNull();
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });

  it("catches a double-click race's second POST 409 and keeps the reading page usable", async () => {
    vi.useFakeTimers();
    try {
      window.HTMLElement.prototype.scrollIntoView = vi.fn();
      const translating: ChapterPayload = {
        translationStatus: "translating",
        translationPercent: 0,
        translationError: null,
        translationAvailable: true,
      };
      let acceptFirst!: () => void;
      const postResponse = vi
        .fn<() => Promise<Response>>()
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              acceptFirst = () =>
                resolve(
                  new Response(JSON.stringify(translating), { status: 202 })
                );
            })
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({ error: "chapter is already translating" }),
            { status: 409 }
          )
        );
      const { calls } = stubTranslateFetch({
        chapterPayloads: [
          {
            translationStatus: "untranslated",
            translationPercent: null,
            translationError: null,
            translationAvailable: true,
            blocks: chapterBlocks,
          },
          {
            translationStatus: "translated",
            translationPercent: null,
            translationError: null,
            translationAvailable: true,
            blocks: chapterBlocks,
          },
        ],
        postBody: translating,
        postResponse,
      });
      renderReadingPage();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      const button = screen.getByRole("button", { name: "翻译" });
      fireEvent.click(button);
      fireEvent.click(button);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(calls.filter((call) => call.init.method === "POST")).toHaveLength(
        2
      );
      expect(screen.getByRole("alert").textContent).toBe(
        "翻译启动失败，请重试。"
      );
      expect(document.querySelector(".original-line")?.textContent).toBe(
        "Mr. Gupta woke early."
      );
      fireEvent.click(screen.getByRole("button", { name: "目录" }));
      expect(screen.getByRole("navigation", { name: "目录" })).toBeTruthy();

      // The winning response can still arrive after the losing 409;
      // polling must follow it through to the settled chapter.
      await act(async () => {
        acceptFirst();
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(screen.getByRole("button", { name: "翻译中 0%" })).toBeTruthy();
      // The winning 202 is the loser's 409's recovery: the notice cannot
      // outlive the translating state it contradicts.
      expect(screen.queryByRole("alert")).toBeNull();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1500);
      });
      expect(screen.getByRole("button", { name: "已翻译" })).toBeTruthy();
      expect(screen.queryByRole("alert")).toBeNull();
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });
  it("re-arms the follow on a chapter jump between two translating chapters: first tick a full interval later", async () => {
    vi.useFakeTimers();
    try {
      window.HTMLElement.prototype.scrollIntoView = vi.fn();
      // Both chapters answer translating: the jump happens mid-follow, the
      // corner the hook's [active, intervalMs] re-arm keys on (code-review
      // 2026-10-24, Standards axis).
      const translating: ChapterPayload = {
        translationStatus: "translating",
        translationPercent: 10,
        translationError: null,
        translationAvailable: true,
        blocks: chapterBlocks,
      };
      const chapter3: ChapterPayload = {
        ...translating,
        translationPercent: 30,
      };
      const calls: Call[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: unknown, init?: RequestInit) => {
          const url = String(input);
          calls.push({ url, init: init ?? {} });
          if (url.endsWith("/chapters/3")) {
            return new Response(JSON.stringify(chapter3));
          }
          if (url.endsWith("/chapters/2")) {
            return new Response(JSON.stringify(translating));
          }
          if (url.endsWith("/progress")) {
            return new Response(JSON.stringify({ chapter: 2, block: 1 }));
          }
          if (url.endsWith("/api/books/7")) {
            return new Response(
              JSON.stringify({
                id: 7,
                title: "Probe Book",
                chapters: [
                  { position: 1, title: "One", level: 2 },
                  { position: 2, title: "Two", level: 2 },
                  { position: 3, title: "Three", level: 2 },
                ],
              })
            );
          }
          return new Response(null, { status: 404 });
        })
      );
      renderReadingPage();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(screen.getByRole("button", { name: "翻译中 10%" })).toBeTruthy();

      // Jump to chapter 3 while it too is translating.
      fireEvent.click(screen.getByRole("link", { name: "下一章 →" }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(screen.getByRole("button", { name: "翻译中 30%" })).toBeTruthy();

      const chapterGets = (position: number) =>
        calls.filter(
          (call) =>
            call.url.endsWith(`/chapters/${position}`) &&
            call.init.method === undefined
        ).length;
      const ch3AtLoad = chapterGets(3);
      const ch2AtJump = chapterGets(2);

      // The re-armed follow starts counting from zero: no chapter-3 poll
      // inside the first interval window, and the torn-down chapter-2
      // follow never polls again.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1499);
      });
      expect(chapterGets(3)).toBe(ch3AtLoad);
      expect(chapterGets(2)).toBe(ch2AtJump);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(chapterGets(3)).toBe(ch3AtLoad + 1);
      expect(chapterGets(2)).toBe(ch2AtJump);
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });
});

// The untranslated-chapter semantics (on-demand-translation ticket 03): a
// wholly untranslated chapter renders no translation lines and greys the
// 译文行 toggle; a chapter with individual holes keeps the pinned
// placeholder shape and a live toggle; an unconfigured service greys the
// translate button behind a visible hint instead of a 409 surprise.
describe("ReadingPage's untranslated-chapter semantics (ticket 03)", () => {
  const untranslatedBlocks: Block[] = [
    {
      position: 1,
      kind: "sentence",
      originalText: "Mr. Gupta woke early.",
      ipaSlots: null,
      ipaText: null,
      translationText: null,
      wordStatuses: [null, null, null, null],
    },
    {
      position: 2,
      kind: "sentence",
      originalText: "The morning was quiet.",
      ipaSlots: null,
      ipaText: null,
      translationText: null,
      wordStatuses: [null, null, null, null],
    },
  ];
  // The individual-hole shape: one sentence translated, the next failed
  // and left empty (the chapter task's retry-exhausted 留空).
  const holeBlocks: Block[] = [
    {
      position: 1,
      kind: "sentence",
      originalText: "Mr. Gupta woke early.",
      ipaSlots: null,
      ipaText: null,
      translationText: "古普塔先生醒得很早。",
      wordStatuses: [null, null, null, null],
    },
    {
      position: 2,
      kind: "sentence",
      originalText: "The morning was quiet.",
      ipaSlots: null,
      ipaText: null,
      translationText: null,
      wordStatuses: [null, null, null, null],
    },
  ];

  beforeEach(clearAnnotationToggles);

  function stubChapterFetch(payload: Record<string, unknown>): void {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) => {
        const url = String(input);
        if (url.endsWith("/chapters/2")) {
          return new Response(JSON.stringify(payload));
        }
        if (url.endsWith("/progress")) {
          return new Response(JSON.stringify({ chapter: 2, block: 1 }));
        }
        if (url.endsWith("/api/books/7")) {
          return new Response(
            JSON.stringify({
              id: 7,
              title: "Probe Book",
              chapters: [{ position: 2, title: "Two", level: 2 }],
            })
          );
        }
        return new Response(null, { status: 404 });
      })
    );
  }

  function chapterPayload(options: {
    translationAvailable?: boolean;
    blocks: Block[];
  }): Record<string, unknown> {
    return {
      position: 2,
      title: "Chapter Two",
      translationStatus: "untranslated",
      translationPercent: null,
      translationError: null,
      translationAvailable: options.translationAvailable ?? true,
      blocks: options.blocks,
    };
  }

  it("renders no translation lines and grays the 译文行 toggle on a wholly untranslated chapter", async () => {
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    stubChapterFetch(chapterPayload({ blocks: untranslatedBlocks }));
    renderReadingPage();
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText("Chapter Two")).toBeTruthy();

    // Not one translation-line element anywhere — not even the empty
    // placeholders.
    expect(document.querySelectorAll(".translation-line")).toHaveLength(0);
    // The original lines are untouched.
    expect(document.querySelectorAll(".original-line")).toHaveLength(2);

    // The toggle grays: visible in the settings panel, but not operable.
    fireEvent.click(screen.getByRole("button", { name: "显示设置" }));
    const translationBox = screen.getByRole("checkbox", {
      name: "译文行",
    }) as HTMLInputElement;
    expect(translationBox.disabled).toBe(true);
    // The button stays live — the service is configured, the chapter is
    // simply not translated yet.
    const button = screen.getByRole("button", { name: "翻译" });
    expect((button as HTMLButtonElement).disabled).toBe(false);
    vi.unstubAllGlobals();
  });

  it("keeps the placeholder line for an individual hole and the toggle usable", async () => {
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    stubChapterFetch(chapterPayload({ blocks: holeBlocks }));
    renderReadingPage();
    await act(async () => {
      await Promise.resolve();
    });

    // Both sentence blocks render their three lines; the hole's
    // translation line is the empty placeholder (既有渲染分支，只钉不改).
    const lines = document.querySelectorAll(
      ".sentence-block .translation-line"
    );
    expect(lines).toHaveLength(2);
    expect(lines[0]!.textContent).toBe("古普塔先生醒得很早。");
    expect(lines[1]!.textContent).toBe("");

    // A hole is not a whole-chapter zero: the toggle stays operable.
    fireEvent.click(screen.getByRole("button", { name: "显示设置" }));
    const translationBox = screen.getByRole("checkbox", {
      name: "译文行",
    }) as HTMLInputElement;
    expect(translationBox.disabled).toBe(false);
    vi.unstubAllGlobals();
  });

  it("grays the translate button with a visible hint while no service is configured", async () => {
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    stubChapterFetch(
      chapterPayload({
        translationAvailable: false,
        blocks: untranslatedBlocks,
      })
    );
    renderReadingPage();
    await act(async () => {
      await Promise.resolve();
    });

    // Grayed, not hidden: the button keeps its label and carries the
    // disabled state; the hint says why.
    const button = screen.getByRole("button", {
      name: "翻译",
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(screen.getByText(/未配置翻译服务/)).toBeTruthy();
    vi.unstubAllGlobals();
  });
});
