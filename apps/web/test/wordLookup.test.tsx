import { useState, type ComponentProps } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { ReadingView, type Block, type WordClick } from "../src/ReadingView";
import { WordLookupPopup } from "../src/WordLookupPopup";
import { speakWord } from "../src/wordLookup";

// How ReadingPage wires the two seams together: the view reports clicks, the
// popup renders for the current word.
function LookupHarness({
  blocks,
  onStatusApplied = () => {},
}: {
  blocks: Block[];
  onStatusApplied?: ComponentProps<typeof WordLookupPopup>["onStatusApplied"];
}) {
  const [click, setClick] = useState<WordClick | null>(null);
  return (
    <>
      <ReadingView
        chapter={{ position: 2, title: "Chapter One: Red", blocks }}
        onWordClick={setClick}
      />
      {click ? (
        <WordLookupPopup
          click={click}
          onClose={() => setClick(null)}
          onStatusApplied={onStatusApplied}
        />
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
    // Token order, null = New: Gupta ignored and early known render
    // settled (the hover tint withdrawn), the rest stay affordances.
    wordStatuses: ["learning", "ignored", null, "known"],
  },
  {
    position: 2,
    kind: "sentence",
    originalText: "A book without slots.",
    ipaSlots: null,
    ipaText: null,
    translationText: "一本没有槽位的书。",
    wordStatuses: [null, null, null, null],
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
    status: "learning",
  });
  try {
    render(
      <WordLookupPopup
        click={{ word: "wrote", point: { x: 100, y: 100 } }}
        onClose={() => {}}
        onStatusApplied={() => {}}
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
    status: "learning",
  });
  render(
    <WordLookupPopup
      click={{ word: "iguana", point: { x: 100, y: 100 } }}
      onClose={() => {}}
      onStatusApplied={() => {}}
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
      onStatusApplied={() => {}}
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
      onStatusApplied={() => {}}
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
    status: "learning",
  });
  const synthesis = stubSpeech();
  try {
    render(
      <WordLookupPopup
        click={{ word: "wrote", point: { x: 100, y: 100 } }}
        onClose={() => {}}
        onStatusApplied={() => {}}
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
        onStatusApplied={() => {}}
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
    status: "learning",
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
    status: "learning",
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
      onStatusApplied={() => {}}
    />
  );
  const popup = screen.getByRole("dialog");
  expect(popup).toHaveStyle({ left: "20px", top: "74px" });

  rerender(
    <WordLookupPopup
      click={{ word: "x", point: { x: 5000, y: 5000 } }}
      onClose={() => {}}
      onStatusApplied={() => {}}
    />
  );
  expect(screen.getByRole("dialog")).toHaveStyle({
    left: "728px",
    top: "504px",
  });
});

it("drops the hover affordance on known and ignored words but keeps them clickable", () => {
  const onWordClick = vi.fn();
  render(
    <ReadingView
      chapter={{ position: 2, title: "Chapter One: Red", blocks: lookupBlocks }}
      onWordClick={onWordClick}
    />
  );
  // Positional ride: Gupta (ignored) and early (known) render settled;
  // woke (New) and Mr (learning) keep the full affordance. Paired mode
  // nests the word text inside the IPA unit — assert on the data-word span.
  const unit = (word: string) => screen.getByText(word).closest("[data-word]");
  expect(unit("Gupta")).toHaveClass("ipa-word", "word-settled");
  expect(unit("early")).toHaveClass("ipa-word", "word-settled");
  expect(unit("woke")).toHaveClass("ipa-word");
  expect(unit("woke")).not.toHaveClass("word-settled");
  expect(unit("Mr")).not.toHaveClass("word-settled");
  // The affordance withdraws; the lookup itself stays.
  fireEvent.click(screen.getByText("Gupta"));
  expect(onWordClick).toHaveBeenCalledWith({
    word: "Gupta",
    point: { x: 0, y: 0 },
  });
});

it("offers the three 生词本 operations and marks the current state", async () => {
  stubLookupResponse({
    word: "wrote",
    lemma: "write",
    ipa: "roʊt",
    pos: "v.",
    translation: "v. 写, 作曲, 写信",
    status: "learning",
  });
  render(
    <WordLookupPopup
      click={{ word: "wrote", point: { x: 100, y: 100 } }}
      onClose={() => {}}
      onStatusApplied={() => {}}
    />
  );
  await screen.findByText("/roʊt/");
  const group = screen.getByRole("group", { name: "生词本状态" });
  expect(group).toBeInTheDocument();
  // The button row is the whole operation set; the current state is the
  // pressed one.
  expect(screen.getByRole("button", { name: "学习中" })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  expect(screen.getByRole("button", { name: "已掌握" })).toHaveAttribute(
    "aria-pressed",
    "false"
  );
  expect(screen.getByRole("button", { name: "已忽略" })).toHaveAttribute(
    "aria-pressed",
    "false"
  );
});

it("sets a state through PUT keyed on the lemma and moves the pressed state", async () => {
  const fetchMock = stubLookupResponse({
    word: "wrote",
    lemma: "write",
    ipa: "roʊt",
    pos: "v.",
    translation: "v. 写, 作曲, 写信",
    status: "learning",
  });
  render(
    <WordLookupPopup
      click={{ word: "wrote", point: { x: 100, y: 100 } }}
      onClose={() => {}}
      onStatusApplied={() => {}}
    />
  );
  await screen.findByText("/roʊt/");
  fireEvent.click(screen.getByRole("button", { name: "已掌握" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "已掌握" })).toHaveAttribute(
      "aria-pressed",
      "true"
    )
  );
  // The PUT keys on the lemma ("write", not the surface "wrote") and
  // carries the machine status — the real request shape.
  expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/vocab/lemmas/write");
  expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
    method: "PUT",
    body: JSON.stringify({ status: "known" }),
  });
  expect(screen.getByRole("button", { name: "学习中" })).toHaveAttribute(
    "aria-pressed",
    "false"
  );
});

it("shows a notice when the state save fails and clears it when a retry lands", async () => {
  const fetchMock = vi
    .fn<(url: string, init?: RequestInit) => Promise<Response>>()
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          word: "wrote",
          lemma: "write",
          ipa: "roʊt",
          pos: "v.",
          translation: "v. 写, 作曲, 写信",
          status: "learning",
        }),
        { status: 200 }
      )
    )
    // The first PUT misses (500); the retry lands.
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "boom" }), { status: 500 })
    )
    // The real PUT 200 body: the saved lemma and status (JSON — a bodyless
    // 2xx would fail fetchJson's parse and read as a failure).
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ lemma: "write", status: "known" }), {
        status: 200,
      })
    );
  vi.stubGlobal("fetch", fetchMock);
  try {
    render(
      <WordLookupPopup
        click={{ word: "wrote", point: { x: 100, y: 100 } }}
        onClose={() => {}}
        onStatusApplied={() => {}}
      />
    );
    await screen.findByText("/roʊt/");
    fireEvent.click(screen.getByRole("button", { name: "已掌握" }));
    expect(
      await screen.findByText("状态保存失败，请重试。")
    ).toBeInTheDocument();
    // The failed save must not move the pressed state.
    expect(screen.getByRole("button", { name: "已掌握" })).toHaveAttribute(
      "aria-pressed",
      "false"
    );
    fireEvent.click(screen.getByRole("button", { name: "已掌握" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "已掌握" })).toHaveAttribute(
        "aria-pressed",
        "true"
      )
    );
    // A landed attempt is the failure notice's recovery.
    expect(screen.queryByText("状态保存失败，请重试。")).toBeNull();
  } finally {
    vi.unstubAllGlobals();
  }
});

// A PUT the test resolves by hand: the race tests hold the save in flight.
function deferredResponse(): {
  promise: Promise<Response>;
  resolve: (response: Response) => void;
} {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const WOKE_ENTRY = {
  word: "woke",
  lemma: "wake",
  ipa: "ˈwoʊk",
  pos: "v.",
  translation: "v. 醒来, 唤醒",
  status: "learning",
};
const BOOK_ENTRY = {
  word: "book",
  lemma: null,
  ipa: "bʊk",
  pos: "n. v.",
  translation: "n. 书, 簿, 账册\nv. 预订, 登记",
  status: "learning",
};

it("reports a successful PUT once with the captured surface, lemma, and status", async () => {
  const put = deferredResponse();
  const onStatusApplied = vi.fn();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "PUT") return put.promise;
      return new Response(
        JSON.stringify({
          word: "wrote",
          lemma: "write",
          ipa: "roʊt",
          pos: "v.",
          translation: "v. 写, 作曲, 写信",
          status: "learning",
        })
      );
    })
  );
  try {
    render(
      <WordLookupPopup
        click={{ word: "wrote", point: { x: 100, y: 100 } }}
        onClose={() => {}}
        onStatusApplied={onStatusApplied}
      />
    );
    await screen.findByText("原形 write");
    fireEvent.click(screen.getByRole("button", { name: "已掌握" }));
    expect(onStatusApplied).not.toHaveBeenCalled();
    put.resolve(
      new Response(JSON.stringify({ lemma: "write", status: "known" }), {
        status: 200,
      })
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "已掌握" })).toBeEnabled()
    );
    expect(onStatusApplied).toHaveBeenCalledExactlyOnceWith({
      word: "wrote",
      lemma: "write",
      status: "known",
    });
  } finally {
    vi.unstubAllGlobals();
  }
});

it("reports the original word's saved fact after the popup moves without patching the new word", async () => {
  const put = deferredResponse();
  const onStatusApplied = vi.fn();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "PUT") return put.promise;
      const entry = url.endsWith("/lookup/woke") ? WOKE_ENTRY : BOOK_ENTRY;
      return new Response(JSON.stringify(entry));
    })
  );
  try {
    render(
      <LookupHarness blocks={lookupBlocks} onStatusApplied={onStatusApplied} />
    );
    fireEvent.click(screen.getByText("woke"));
    await screen.findByText("/ˈwoʊk/");
    fireEvent.click(screen.getByRole("button", { name: "已掌握" }));
    fireEvent.click(screen.getByText("book"));
    await screen.findByText("/bʊk/");
    expect(onStatusApplied).not.toHaveBeenCalled();
    put.resolve(
      new Response(JSON.stringify({ lemma: "wake", status: "known" }), {
        status: 200,
      })
    );
    await waitFor(() =>
      expect(onStatusApplied).toHaveBeenCalledExactlyOnceWith({
        word: "woke",
        lemma: "wake",
        status: "known",
      })
    );
    expect(screen.getByRole("dialog", { name: "词详情：book" })).toBeVisible();
    expect(screen.getByRole("button", { name: "学习中" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(screen.getByRole("button", { name: "已掌握" })).toHaveAttribute(
      "aria-pressed",
      "false"
    );
  } finally {
    vi.unstubAllGlobals();
  }
});

it("keeps failed PUTs inside the popup and reports only the successful retry", async () => {
  const onStatusApplied = vi.fn();
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(new Response(JSON.stringify(WOKE_ENTRY)))
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "boom" }), { status: 500 })
    )
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ lemma: "wake", status: "known" }), {
        status: 200,
      })
    );
  vi.stubGlobal("fetch", fetchMock);
  try {
    render(
      <WordLookupPopup
        click={{ word: "woke", point: { x: 100, y: 100 } }}
        onClose={() => {}}
        onStatusApplied={onStatusApplied}
      />
    );
    await screen.findByText("/ˈwoʊk/");
    fireEvent.click(screen.getByRole("button", { name: "已掌握" }));
    expect(
      await screen.findByText("状态保存失败，请重试。")
    ).toBeInTheDocument();
    expect(onStatusApplied).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "已掌握" })).toHaveAttribute(
      "aria-pressed",
      "false"
    );
    // Recovery also pins the positive path, so omitting the callback cannot
    // make this failure test pass vacuously.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "已掌握" })).toBeEnabled()
    );
    fireEvent.click(screen.getByRole("button", { name: "已掌握" }));
    await waitFor(() =>
      expect(onStatusApplied).toHaveBeenCalledExactlyOnceWith({
        word: "woke",
        lemma: "wake",
        status: "known",
      })
    );
    expect(screen.queryByText("状态保存失败，请重试。")).toBeNull();
  } finally {
    vi.unstubAllGlobals();
  }
});

it("disables the state row while a save is in flight", async () => {
  const put = deferredResponse();
  const fetchMock = vi.fn<
    (url: string, init?: RequestInit) => Promise<Response>
  >((url, init) => {
    if (init?.method === "PUT") return put.promise;
    return Promise.resolve(
      new Response(JSON.stringify(WOKE_ENTRY), { status: 200 })
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  try {
    render(
      <WordLookupPopup
        click={{ word: "woke", point: { x: 100, y: 100 } }}
        onClose={() => {}}
        onStatusApplied={() => {}}
      />
    );
    await screen.findByText("/ˈwoʊk/");
    fireEvent.click(screen.getByRole("button", { name: "已掌握" }));
    // One save at a time: the whole row waits, so two clicks cannot race
    // into an out-of-order last-write.
    expect(screen.getByRole("button", { name: "已掌握" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "学习中" })).toBeDisabled();
    put.resolve(
      new Response(JSON.stringify({ lemma: "wake", status: "known" }), {
        status: 200,
      })
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "已掌握" })).toBeEnabled()
    );
    expect(screen.getByRole("button", { name: "已掌握" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
  } finally {
    vi.unstubAllGlobals();
  }
});

it("does not patch a save's verdict onto a word the popup moved to", async () => {
  const put = deferredResponse();
  const fetchMock = vi.fn<
    (url: string, init?: RequestInit) => Promise<Response>
  >((url, init) => {
    if (init?.method === "PUT") return put.promise;
    const entry = String(url).endsWith("/lookup/woke")
      ? WOKE_ENTRY
      : BOOK_ENTRY;
    return Promise.resolve(
      new Response(JSON.stringify(entry), { status: 200 })
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  try {
    render(<LookupHarness blocks={lookupBlocks} />);
    fireEvent.click(screen.getByText("woke"));
    await screen.findByText("/ˈwoʊk/");
    fireEvent.click(screen.getByRole("button", { name: "已掌握" }));
    // The reader moves on before the save lands: book's popup is its own
    // story, and woke's in-flight verdict must not write over it.
    fireEvent.click(screen.getByText("book"));
    expect(
      await screen.findByRole("dialog", { name: "词详情：book" })
    ).toBeInTheDocument();
    put.resolve(
      new Response(JSON.stringify({ lemma: "wake", status: "known" }), {
        status: 200,
      })
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "已掌握" })).toBeEnabled()
    );
    expect(screen.getByRole("button", { name: "学习中" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(screen.getByRole("button", { name: "已掌握" })).toHaveAttribute(
      "aria-pressed",
      "false"
    );
  } finally {
    vi.unstubAllGlobals();
  }
});

it("keeps the new word's row disabled when the previous word's save settles first", async () => {
  const wokePut = deferredResponse();
  const bookPut = deferredResponse();
  const onStatusApplied = vi.fn();
  const fetchMock = vi.fn<
    (url: string, init?: RequestInit) => Promise<Response>
  >((url, init) => {
    if (init?.method === "PUT") {
      return String(url).endsWith("/lemmas/wake")
        ? wokePut.promise
        : bookPut.promise;
    }
    const entry = String(url).endsWith("/lookup/woke")
      ? WOKE_ENTRY
      : BOOK_ENTRY;
    return Promise.resolve(
      new Response(JSON.stringify(entry), { status: 200 })
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  try {
    render(
      <LookupHarness blocks={lookupBlocks} onStatusApplied={onStatusApplied} />
    );
    fireEvent.click(screen.getByText("woke"));
    await screen.findByText("/ˈwoʊk/");
    fireEvent.click(screen.getByRole("button", { name: "已掌握" }));
    // The reader saves book before woke's PUT lands: two writes in flight
    // at once, each keyed by the lemma its PUT addresses.
    fireEvent.click(screen.getByText("book"));
    await screen.findByText("/bʊk/");
    fireEvent.click(screen.getByRole("button", { name: "学习中" }));
    // woke settles first; its finally may only retire woke's own entry.
    wokePut.resolve(
      new Response(JSON.stringify({ lemma: "wake", status: "known" }), {
        status: 200,
      })
    );
    await waitFor(() =>
      expect(onStatusApplied).toHaveBeenCalledExactlyOnceWith({
        word: "woke",
        lemma: "wake",
        status: "known",
      })
    );
    // woke's settle must not re-enable book's row mid-write.
    expect(screen.getByRole("button", { name: "学习中" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "已掌握" })).toBeDisabled();
    bookPut.resolve(
      new Response(JSON.stringify({ lemma: "book", status: "learning" }), {
        status: 200,
      })
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "学习中" })).toBeEnabled()
    );
    expect(screen.getByRole("button", { name: "学习中" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
  } finally {
    vi.unstubAllGlobals();
  }
});

it("keeps a revisited word's row disabled until its in-flight write lands", async () => {
  const wokePut = deferredResponse();
  const fetchMock = vi.fn<
    (url: string, init?: RequestInit) => Promise<Response>
  >((url, init) => {
    if (init?.method === "PUT") return wokePut.promise;
    const entry = String(url).endsWith("/lookup/woke")
      ? WOKE_ENTRY
      : BOOK_ENTRY;
    return Promise.resolve(
      new Response(JSON.stringify(entry), { status: 200 })
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  try {
    render(<LookupHarness blocks={lookupBlocks} />);
    fireEvent.click(screen.getByText("woke"));
    await screen.findByText("/ˈwoʊk/");
    fireEvent.click(screen.getByRole("button", { name: "已掌握" }));
    // The reader moves to book while woke's write is in flight: book's
    // row reads only its own key, so it stays usable.
    fireEvent.click(screen.getByText("book"));
    expect(
      await screen.findByRole("dialog", { name: "词详情：book" })
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "已掌握" })).toBeEnabled();
    // Then the reader comes back: the write never stopped being in
    // flight, and the owner token's key-comparison revival rule puts
    // woke's ticket back in charge — the row is disabled again.
    // Characterization: flip this test if the revival rule is ever
    // deliberately changed.
    fireEvent.click(screen.getByText("woke"));
    await screen.findByText("/ˈwoʊk/");
    expect(screen.getByRole("button", { name: "已掌握" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "学习中" })).toBeDisabled();
    wokePut.resolve(
      new Response(JSON.stringify({ lemma: "wake", status: "known" }), {
        status: 200,
      })
    );
    // The landing write re-enables the row and patches the shown state:
    // the verdict belongs to the word, and the popup is back on it.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "已掌握" })).toBeEnabled()
    );
    expect(screen.getByRole("button", { name: "已掌握" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
  } finally {
    vi.unstubAllGlobals();
  }
});

it("shares one in-flight save across word forms of the same lemma", async () => {
  const runPut = deferredResponse();
  const onStatusApplied = vi.fn();
  const RUNS_ENTRY = {
    word: "runs",
    lemma: "run",
    ipa: "rʌnz",
    pos: "v.",
    translation: "v. 跑",
    status: "learning",
  };
  const RUN_ENTRY = {
    word: "run",
    lemma: "run",
    ipa: "rʌn",
    pos: "v. n.",
    translation: "v. 跑; n. 跑",
    status: "learning",
  };
  const fetchMock = vi.fn<
    (url: string, init?: RequestInit) => Promise<Response>
  >((url, init) => {
    if (init?.method === "PUT") return runPut.promise;
    const entry = String(url).endsWith("/lookup/runs") ? RUNS_ENTRY : RUN_ENTRY;
    return Promise.resolve(
      new Response(JSON.stringify(entry), { status: 200 })
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  try {
    const view = render(
      <WordLookupPopup
        click={{ word: "runs", point: { x: 100, y: 100 } }}
        onClose={() => {}}
        onStatusApplied={onStatusApplied}
      />
    );
    await screen.findByText("/rʌnz/");
    fireEvent.click(screen.getByRole("button", { name: "已掌握" }));
    // A same-instance word change — the popup's whole story: run folds
    // to the same lemma, so it reads the same entry's key.
    // Characterization: the write is per server word, not per surface —
    // run's row waits on runs' PUT. Flip this test if that sharing is
    // ever deliberately changed.
    view.rerender(
      <WordLookupPopup
        click={{ word: "run", point: { x: 100, y: 100 } }}
        onClose={() => {}}
        onStatusApplied={onStatusApplied}
      />
    );
    await screen.findByText("/rʌn/");
    expect(screen.getByRole("button", { name: "已掌握" })).toBeDisabled();
    runPut.resolve(
      new Response(JSON.stringify({ lemma: "run", status: "known" }), {
        status: 200,
      })
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "已掌握" })).toBeEnabled()
    );
    // The verdict stays with the word it was saved from: run's shown
    // state is its own lookup's, not runs' patch.
    expect(screen.getByRole("button", { name: "学习中" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(onStatusApplied).toHaveBeenCalledExactlyOnceWith({
      word: "runs",
      lemma: "run",
      status: "known",
    });
  } finally {
    vi.unstubAllGlobals();
  }
});

it("leaves a failed save's notice behind when the reader moves to another word", async () => {
  const fetchMock = vi
    .fn<(url: string, init?: RequestInit) => Promise<Response>>()
    // Call order: woke's lookup, the failed PUT, then book's lookup.
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          word: "woke",
          lemma: "wake",
          ipa: "ˈwoʊk",
          pos: "v.",
          translation: "v. 醒来, 唤醒",
          status: "learning",
        }),
        { status: 200 }
      )
    )
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "boom" }), { status: 500 })
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          word: "book",
          lemma: null,
          ipa: "bʊk",
          pos: "n. v.",
          translation: "n. 书, 簿, 账册\nv. 预订, 登记",
          status: "learning",
        }),
        { status: 200 }
      )
    );
  vi.stubGlobal("fetch", fetchMock);
  try {
    render(<LookupHarness blocks={lookupBlocks} />);
    fireEvent.click(screen.getByText("woke"));
    await screen.findByText("/ˈwoʊk/");
    fireEvent.click(screen.getByRole("button", { name: "已掌握" }));
    expect(
      await screen.findByText("状态保存失败，请重试。")
    ).toBeInTheDocument();
    // Clicking another word re-anchors the popup; the notice belonged to
    // the previous word's save, so it must not follow.
    fireEvent.click(screen.getByText("book"));
    expect(
      await screen.findByRole("dialog", { name: "词详情：book" })
    ).toBeInTheDocument();
    expect(screen.queryByText("状态保存失败，请重试。")).toBeNull();
  } finally {
    vi.unstubAllGlobals();
  }
});

it("closes when the reader scrolls or the viewport resizes", async () => {
  stubLookupResponse({
    word: "woke",
    lemma: "wake",
    ipa: "ˈwoʊk",
    pos: "v.",
    translation: "v. 醒来, 唤醒",
    status: "learning",
  });
  const onClose = vi.fn();
  render(
    <WordLookupPopup
      click={{ word: "woke", point: { x: 100, y: 100 } }}
      onClose={onClose}
      onStatusApplied={() => {}}
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
