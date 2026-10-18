import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { ReadingView, type Block, type WordClick } from "../src/ReadingView";
import { WordLookupPopup } from "../src/WordLookupPopup";
import { speakWord } from "../src/wordLookup";

// How ReadingPage wires the two seams together: the view reports clicks, the
// popup renders for the current word.
function LookupHarness({ blocks }: { blocks: Block[] }) {
  const [click, setClick] = useState<WordClick | null>(null);
  return (
    <>
      <ReadingView
        chapter={{ position: 2, title: "Chapter One: Red", blocks }}
        onWordClick={setClick}
      />
      {click ? (
        <WordLookupPopup click={click} onClose={() => setClick(null)} />
      ) : null}
    </>
  );
}

// The popup always fetches; every popup test stubs fetch at the seam.
function stubLookupResponse(body: unknown, status = 200) {
  const fetchMock = vi.fn<
    (url: string, init?: RequestInit) => Promise<Response>
  >(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

// One paired block (slots align with the words) and one plain block, plus a
// code block that must stay outside the word-click seam.
const lookupBlocks: Block[] = [
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
    ipaText: null,
    translationText: "一本没有槽位的书。",
  },
  { position: 3, kind: "code", originalText: "npm run dict:import-ecdict" },
];

it("reports the clicked word and the click point from the original line", () => {
  const onWordClick = vi.fn();
  render(
    <ReadingView
      chapter={{ position: 2, title: "Chapter One: Red", blocks: lookupBlocks }}
      onWordClick={onWordClick}
    />
  );

  // Paired mode: the click lands on the word text inside the IPA unit.
  fireEvent.click(screen.getByText("Gupta"));
  expect(onWordClick).toHaveBeenCalledWith({
    word: "Gupta",
    point: { x: 0, y: 0 },
  });

  // Plain mode (no slots): words are still individually clickable.
  fireEvent.click(screen.getByText("book"));
  expect(onWordClick).toHaveBeenLastCalledWith({
    word: "book",
    point: { x: 0, y: 0 },
  });

  // Translation lines and code blocks are not word sources.
  fireEvent.click(screen.getByText("古普塔先生醒得很早。"));
  fireEvent.click(screen.getByText("npm run dict:import-ecdict"));
  expect(onWordClick).toHaveBeenCalledTimes(2);
});

it("shows IPA, part of speech, translation, and the lemma for a found word", async () => {
  // Real response shape for GET /api/lookup/wrote (CODING_STANDARDS: client
  // stubs model what the server actually returns, five fields, nullable).
  const fetchMock = stubLookupResponse({
    word: "wrote",
    lemma: "write",
    ipa: "roʊt",
    pos: "v.",
    translation: "v. 写, 作曲, 写信",
  });
  try {
    render(
      <WordLookupPopup
        click={{ word: "wrote", point: { x: 100, y: 100 } }}
        onClose={() => {}}
      />
    );

    // The lemma chip is the visible half of "点击变形词时展示原型词的释义"
    // (the definition itself comes from the lemma through the API).
    expect(await screen.findByText("原形 write")).toBeInTheDocument();
    // fetchJson invokes fetch(url, init) — the recorded init is undefined.
    expect(fetchMock.mock.calls).toEqual([["/api/lookup/wrote", undefined]]);
    expect(screen.getByText("/roʊt/")).toBeInTheDocument();
    expect(screen.getByText("v.")).toBeInTheDocument();
    expect(document.querySelector(".lookup-translation")?.textContent).toBe(
      "v. 写, 作曲, 写信"
    );
  } finally {
    vi.unstubAllGlobals();
  }
});

it("omits the IPA, part-of-speech, and lemma rows when the entry lacks them", async () => {
  // Thin entries are real data: nullable fields stay null.
  stubLookupResponse({
    word: "iguana",
    lemma: null,
    ipa: null,
    pos: null,
    translation: "n. 鬣蜥",
  });
  render(
    <WordLookupPopup
      click={{ word: "iguana", point: { x: 100, y: 100 } }}
      onClose={() => {}}
    />
  );
  expect(await screen.findByText("n. 鬣蜥")).toBeInTheDocument();
  expect(document.querySelector(".lookup-ipa")).toBeNull();
  expect(document.querySelector(".lookup-pos")).toBeNull();
  expect(screen.queryByText(/原形/)).toBeNull();
});

it("reports a word missing from the dictionary without failing", async () => {
  // Real 404 body from the lookup router.
  stubLookupResponse({ error: "word not found" }, 404);
  render(
    <WordLookupPopup
      click={{ word: "iguana", point: { x: 100, y: 100 } }}
      onClose={() => {}}
    />
  );
  expect(await screen.findByText("词库中未收录这个词。")).toBeInTheDocument();
  expect(document.querySelector(".lookup-translation")).toBeNull();
});

it("reports a failed lookup as a failure, not as a missing word", async () => {
  stubLookupResponse({ error: "boom" }, 503);
  render(
    <WordLookupPopup
      click={{ word: "iguana", point: { x: 100, y: 100 } }}
      onClose={() => {}}
    />
  );
  expect(await screen.findByText("查询失败，请稍后再试。")).toBeInTheDocument();
});

// Minimal stand-in: speakWord only constructs one and sets .lang/.text.
class FakeUtterance {
  text: string;
  lang = "";
  constructor(text: string) {
    this.text = text;
  }
}

function stubSpeech() {
  const synthesis = {
    cancel: vi.fn(),
    speak: vi.fn<(utterance: FakeUtterance) => void>(),
  };
  vi.stubGlobal("speechSynthesis", synthesis);
  vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
  return synthesis;
}

it("speaks the word through browser speech synthesis from the 发音 button", async () => {
  stubLookupResponse({
    word: "wrote",
    lemma: "write",
    ipa: "roʊt",
    pos: "v.",
    translation: "v. 写, 作曲, 写信",
  });
  const synthesis = stubSpeech();
  try {
    render(
      <WordLookupPopup
        click={{ word: "wrote", point: { x: 100, y: 100 } }}
        onClose={() => {}}
      />
    );
    await screen.findByText("/roʊt/");
    fireEvent.click(screen.getByRole("button", { name: "发音" }));

    expect(synthesis.cancel).toHaveBeenCalled();
    expect(synthesis.speak).toHaveBeenCalledTimes(1);
    const utterance = synthesis.speak.mock.calls[0]?.[0];
    expect(utterance?.text).toBe("wrote");
    expect(utterance?.lang).toBe("en-US");
  } finally {
    vi.unstubAllGlobals();
  }
});

it("stays silent when the environment has no speech synthesis", () => {
  // jsdom and older browsers: the API is absent — a click must not throw.
  vi.stubGlobal("speechSynthesis", undefined);
  vi.stubGlobal("SpeechSynthesisUtterance", undefined);
  try {
    expect(() => speakWord("wrote")).not.toThrow();

    stubLookupResponse({ error: "word not found" }, 404);
    render(
      <WordLookupPopup
        click={{ word: "iguana", point: { x: 100, y: 100 } }}
        onClose={() => {}}
      />
    );
    expect(() =>
      fireEvent.click(screen.getByRole("button", { name: "发音" }))
    ).not.toThrow();
  } finally {
    vi.unstubAllGlobals();
  }
});

it("clicking a word opens the popup and fetches that word", async () => {
  const fetchMock = stubLookupResponse({
    word: "woke",
    lemma: "wake",
    ipa: "ˈwoʊk",
    pos: "v.",
    translation: "v. 醒来, 唤醒",
  });
  render(<LookupHarness blocks={lookupBlocks} />);
  fireEvent.click(screen.getByText("woke"));
  expect(await screen.findByText("/ˈwoʊk/")).toBeInTheDocument();
  expect(
    screen.getByRole("dialog", { name: "词详情：woke" })
  ).toBeInTheDocument();
  expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/lookup/woke");
});

it("closes from the 关闭 button, Escape, and clicks outside, but not word clicks", async () => {
  stubLookupResponse({
    word: "woke",
    lemma: "wake",
    ipa: "ˈwoʊk",
    pos: "v.",
    translation: "v. 醒来, 唤醒",
  });
  render(<LookupHarness blocks={lookupBlocks} />);
  fireEvent.click(screen.getByText("woke"));
  expect(await screen.findByRole("dialog")).toBeInTheDocument();

  // Clicking another word moves the popup to that word instead of closing.
  fireEvent.click(screen.getByText("book"));
  expect(
    await screen.findByRole("dialog", { name: "词详情：book" })
  ).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "关闭" }));
  expect(screen.queryByRole("dialog")).toBeNull();

  // Reopen, then Escape.
  fireEvent.click(screen.getByText("woke"));
  expect(await screen.findByRole("dialog")).toBeInTheDocument();
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();

  // Reopen, then a click on neutral ground.
  fireEvent.click(screen.getByText("woke"));
  expect(await screen.findByRole("dialog")).toBeInTheDocument();
  fireEvent.click(document.body);
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("anchors the popup at the click and clamps it inside the viewport", () => {
  stubLookupResponse({ error: "word not found" }, 404);
  // jsdom's viewport is 1024×768; the popup is 288px wide, 256px tall at
  // most, 8px margins (constants mirrored from style.css).
  const { rerender } = render(
    <WordLookupPopup
      click={{ word: "x", point: { x: 40, y: 60 } }}
      onClose={() => {}}
    />
  );
  const popup = screen.getByRole("dialog");
  expect(popup).toHaveStyle({ left: "20px", top: "74px" });

  rerender(
    <WordLookupPopup
      click={{ word: "x", point: { x: 5000, y: 5000 } }}
      onClose={() => {}}
    />
  );
  expect(screen.getByRole("dialog")).toHaveStyle({
    left: "728px",
    top: "504px",
  });
});

it("closes when the reader scrolls or the viewport resizes", async () => {
  stubLookupResponse({
    word: "woke",
    lemma: "wake",
    ipa: "ˈwoʊk",
    pos: "v.",
    translation: "v. 醒来, 唤醒",
  });
  const onClose = vi.fn();
  render(
    <WordLookupPopup
      click={{ word: "woke", point: { x: 100, y: 100 } }}
      onClose={onClose}
    />
  );
  await screen.findByText("/ˈwoʊk/");

  // An anchored popup goes stale the moment the page moves under it —
  // moving on is the dismissal, so scroll and resize both close it.
  fireEvent.scroll(window);
  expect(onClose).toHaveBeenCalledTimes(1);
  fireEvent.resize(window);
  expect(onClose).toHaveBeenCalledTimes(2);
});
