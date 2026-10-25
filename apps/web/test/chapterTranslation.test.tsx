import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ChapterPayload,
  ChapterTranslationState,
} from "../../server/src/wire";
import { useChapterTranslation } from "../src/chapterTranslation";

// The trigger hook owns the POST, failure recovery, stale-route discard,
// and poll follow. The unchanged page assertions pin merge/replace behavior,
// button states, and notice copy at the rendered boundary.
const INTERVAL = 1500;
const translating: ChapterTranslationState = {
  translationStatus: "translating",
  translationPercent: 0,
  translationError: null,
  translationAvailable: true,
};
const chapter: ChapterPayload = {
  ...translating,
  position: 2,
  title: "Two",
  level: 2,
  blocks: [
    {
      position: 1,
      kind: "sentence",
      originalText: "The reader woke early.",
      ipaSlots: null,
      ipaText: null,
      translationText: null,
      wordStatuses: [null, null, null, null],
    },
    { position: 2, kind: "code", originalText: "npm run typecheck" },
  ],
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

async function actAdvance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function accepted() {
  return new Response(JSON.stringify(translating), { status: 202 });
}

// Route requests like the real API: GET payloads advance through the script
// (staying on the last), and POST responses can fail or remain in flight.
function stubTranslateFetch(
  options: {
    chapterPayloads?: ChapterPayload[];
    postResponse?: () => Promise<Response>;
    getResponse?: () => Promise<Response>;
  } = {}
) {
  const payloads = options.chapterPayloads ?? [chapter];
  let payloadIndex = 0;
  const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (url === "/api/books/7/chapters/2/translate" && method === "POST") {
      return options.postResponse ? options.postResponse() : accepted();
    }
    if (url === "/api/books/7/chapters/2" && method === "GET") {
      if (options.getResponse) return options.getResponse();
      const payload = payloads[Math.min(payloadIndex, payloads.length - 1)];
      payloadIndex += 1;
      return new Response(JSON.stringify(payload));
    }
    throw new Error(`Unexpected request: ${method} ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function callbacks() {
  return { onTranslationState: vi.fn(), onTick: vi.fn() };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useChapterTranslation trigger", () => {
  it("hands the 202 state to onTranslationState exactly once without a refresh", async () => {
    const fetchMock = stubTranslateFetch();
    const handlers = callbacks();
    const { result } = renderHook(() =>
      useChapterTranslation({
        active: false,
        bookId: 7,
        chapterNumber: 2,
        ...handlers,
      })
    );

    act(() => result.current.start());
    await actAdvance(0);

    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      "/api/books/7/chapters/2/translate",
      { method: "POST" }
    );
    expect(handlers.onTranslationState).toHaveBeenCalledExactlyOnceWith(
      translating
    );
    expect(handlers.onTick).not.toHaveBeenCalled();
    expect(result.current.startFailed).toBe(false);
  });

  it.each([409, 500])(
    "sets startFailed on a POST %s without patching content",
    async (status) => {
      stubTranslateFetch({
        postResponse: async () =>
          new Response(JSON.stringify({ error: "Rejected" }), { status }),
      });
      const handlers = callbacks();
      const { result } = renderHook(() =>
        useChapterTranslation({
          active: false,
          bookId: 7,
          chapterNumber: 2,
          ...handlers,
        })
      );

      act(() => result.current.start());
      await actAdvance(0);

      expect(result.current.startFailed).toBe(true);
      expect(handlers.onTranslationState).not.toHaveBeenCalled();
      expect(handlers.onTick).not.toHaveBeenCalled();
    }
  );

  it("clears startFailed immediately on retry, before its response lands", async () => {
    const pending = deferred<Response>();
    stubTranslateFetch({
      postResponse: vi
        .fn<() => Promise<Response>>()
        .mockResolvedValueOnce(new Response(null, { status: 500 }))
        .mockReturnValueOnce(pending.promise),
    });
    const handlers = callbacks();
    const { result } = renderHook(() =>
      useChapterTranslation({
        active: false,
        bookId: 7,
        chapterNumber: 2,
        ...handlers,
      })
    );

    act(() => result.current.start());
    await actAdvance(0);
    expect(result.current.startFailed).toBe(true);

    act(() => result.current.start());
    expect(result.current.startFailed).toBe(false);
    expect(handlers.onTranslationState).not.toHaveBeenCalled();
    await act(async () => pending.resolve(accepted()));
    expect(handlers.onTranslationState).toHaveBeenCalledExactlyOnceWith(
      translating
    );
  });

  it("clears a losing double-click's 409 when the winning 202 lands", async () => {
    const winner = deferred<Response>();
    stubTranslateFetch({
      postResponse: vi
        .fn<() => Promise<Response>>()
        .mockReturnValueOnce(winner.promise)
        .mockResolvedValueOnce(new Response(null, { status: 409 })),
    });
    const handlers = callbacks();
    const { result } = renderHook(() =>
      useChapterTranslation({
        active: false,
        bookId: 7,
        chapterNumber: 2,
        ...handlers,
      })
    );

    act(() => {
      result.current.start();
      result.current.start();
    });
    await actAdvance(0);
    expect(result.current.startFailed).toBe(true);

    await act(async () => winner.resolve(accepted()));
    expect(result.current.startFailed).toBe(false);
    expect(handlers.onTranslationState).toHaveBeenCalledExactlyOnceWith(
      translating
    );
  });

  for (const route of [
    { bookId: 7, chapterNumber: 3 },
    { bookId: 8, chapterNumber: 2 },
  ]) {
    it.each([202, 409, 500])(
      `discards a stale POST %s after navigating to book ${route.bookId}, chapter ${route.chapterNumber}`,
      async (status) => {
        const pending = deferred<Response>();
        stubTranslateFetch({ postResponse: () => pending.promise });
        const handlers = callbacks();
        const { result, rerender } = renderHook(
          (currentRoute) =>
            useChapterTranslation({
              active: false,
              ...currentRoute,
              ...handlers,
            }),
          { initialProps: { bookId: 7, chapterNumber: 2 } }
        );

        act(() => result.current.start());
        rerender(route);
        await act(async () =>
          pending.resolve(
            status === 202 ? accepted() : new Response(null, { status })
          )
        );

        expect(handlers.onTranslationState).not.toHaveBeenCalled();
        expect(result.current.startFailed).toBe(false);
      }
    );
  }

  it.each([
    { bookId: 7, chapterNumber: 3 },
    { bookId: 8, chapterNumber: 2 },
  ])(
    "clears startFailed on a route change to $bookId/$chapterNumber",
    async (route) => {
      stubTranslateFetch({
        postResponse: async () => new Response(null, { status: 409 }),
      });
      const handlers = callbacks();
      const { result, rerender } = renderHook(
        (currentRoute) =>
          useChapterTranslation({
            active: false,
            ...currentRoute,
            ...handlers,
          }),
        { initialProps: { bookId: 7, chapterNumber: 2 } }
      );

      act(() => result.current.start());
      await actAdvance(0);
      expect(result.current.startFailed).toBe(true);

      rerender(route);
      expect(result.current.startFailed).toBe(false);
    }
  );
});

describe("useChapterTranslation follow", () => {
  it("hands scripted ticks to onTick after full intervals and clears startFailed", async () => {
    const settled: ChapterPayload = {
      ...chapter,
      translationStatus: "translated",
      translationPercent: null,
      blocks: [{ position: 1, kind: "raw", originalText: "Fresh content" }],
    };
    stubTranslateFetch({
      chapterPayloads: [chapter, settled],
      postResponse: async () => new Response(null, { status: 409 }),
    });
    const handlers = callbacks();
    const { result } = renderHook(() =>
      useChapterTranslation({
        active: true,
        bookId: 7,
        chapterNumber: 2,
        ...handlers,
      })
    );

    act(() => result.current.start());
    await actAdvance(0);
    expect(result.current.startFailed).toBe(true);
    await actAdvance(INTERVAL - 1);
    expect(handlers.onTick).not.toHaveBeenCalled();

    await actAdvance(1);
    expect(handlers.onTick).toHaveBeenCalledExactlyOnceWith(chapter);
    expect(result.current.startFailed).toBe(false);
    expect(handlers.onTranslationState).not.toHaveBeenCalled();

    await actAdvance(INTERVAL);
    expect(handlers.onTick).toHaveBeenCalledTimes(2);
    expect(handlers.onTick).toHaveBeenLastCalledWith(settled);
  });

  it("re-arms on false to true with a full interval before the first tick", async () => {
    const fetchMock = stubTranslateFetch();
    const handlers = callbacks();
    const { rerender } = renderHook(
      ({ active }) =>
        useChapterTranslation({
          active,
          bookId: 7,
          chapterNumber: 2,
          ...handlers,
        }),
      { initialProps: { active: true } }
    );

    await actAdvance(INTERVAL);
    expect(handlers.onTick).toHaveBeenCalledTimes(1);
    await actAdvance(700);
    rerender({ active: false });
    await actAdvance(500);
    rerender({ active: true });

    await actAdvance(INTERVAL - 1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(handlers.onTick).toHaveBeenCalledTimes(1);
    await actAdvance(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(handlers.onTick).toHaveBeenCalledTimes(2);
  });

  it("sets pollFailed on failed GETs and clears it only when a tick lands", async () => {
    const pending = deferred<Response>();
    stubTranslateFetch({
      getResponse: vi
        .fn<() => Promise<Response>>()
        .mockResolvedValueOnce(new Response(null, { status: 503 }))
        .mockResolvedValueOnce(new Response(null, { status: 500 }))
        .mockReturnValueOnce(pending.promise),
    });
    const handlers = callbacks();
    const { result } = renderHook(() =>
      useChapterTranslation({
        active: true,
        bookId: 7,
        chapterNumber: 2,
        ...handlers,
      })
    );

    expect(result.current.pollFailed).toBe(false);
    for (let tick = 0; tick < 3; tick += 1) {
      await actAdvance(INTERVAL);
      expect(result.current.pollFailed).toBe(true);
      expect(handlers.onTick).not.toHaveBeenCalled();
      expect(result.current.startFailed).toBe(false);
    }

    await act(async () =>
      pending.resolve(new Response(JSON.stringify(chapter)))
    );
    expect(handlers.onTick).toHaveBeenCalledExactlyOnceWith(chapter);
    expect(result.current.pollFailed).toBe(false);
  });

  it("stops polling and discards an in-flight tick after active goes false", async () => {
    const pending = deferred<Response>();
    const fetchMock = stubTranslateFetch({
      getResponse: () => pending.promise,
    });
    const handlers = callbacks();
    const { rerender } = renderHook(
      ({ active }) =>
        useChapterTranslation({
          active,
          bookId: 7,
          chapterNumber: 2,
          ...handlers,
        }),
      { initialProps: { active: true } }
    );

    await actAdvance(INTERVAL);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    rerender({ active: false });
    await act(async () =>
      pending.resolve(new Response(JSON.stringify(chapter)))
    );
    await actAdvance(INTERVAL * 3);

    expect(handlers.onTick).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
