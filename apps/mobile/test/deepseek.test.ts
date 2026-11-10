import { describe, expect, it, vi } from "vitest";
import { createDeepSeekTranslator } from "../src/translate/deepseek";

// Ported from apps/server/test/translate/deepseek.test.ts (mobile-app
// ticket 04) — same wire protocol, same failure tolerance, same numbered
// parser. The server's env-config block is dropped: on the phone the
// config comes from the settings store, not the environment.

type CapturedRequest = { url: string; init: RequestInit };

// A fetch stub for the adapter's HTTP boundary: captures every request and
// replies with a scripted chat-completion body (or HTTP status).
function stubFetch(
  reply:
    | { content: string; finishReason?: string }
    | { status: number }
    | { rawBody: unknown }
): {
  fetchImpl: typeof fetch;
  requests: CapturedRequest[];
} {
  const requests: CapturedRequest[] = [];
  const fetchImpl = (async (url: unknown, init?: RequestInit) => {
    requests.push({ url: String(url), init: init ?? {} });
    if ("status" in reply) {
      return new Response("upstream exploded", { status: reply.status });
    }
    const body =
      "rawBody" in reply
        ? reply.rawBody
        : {
            choices: [
              {
                message: { role: "assistant", content: reply.content },
                ...(reply.finishReason
                  ? { finish_reason: reply.finishReason }
                  : {}),
              },
            ],
          };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return { fetchImpl, requests };
}

const CONFIG = {
  apiKey: "sk-test",
  baseUrl: "https://api.deepseek.com",
  model: "deepseek-flash",
  stylePrompt: "自然意译。",
};

describe("createDeepSeekTranslator", () => {
  it("reports every sentence failed when content is not a string", async () => {
    // Valid JSON, broken shape: a numeric/object/array content must land on
    // the all-failed path, not throw past the catch (audit 2026-10-23).
    for (const rawBody of [
      { choices: [{ message: { role: "assistant", content: 42 } }] },
      { choices: [{ message: { role: "assistant", content: { text: "x" } } }] },
      { choices: [{ message: { role: "assistant", content: ["a"] } }] },
      { choices: [] },
      {},
    ]) {
      const { fetchImpl } = stubFetch({ rawBody });
      const translator = createDeepSeekTranslator({ ...CONFIG, fetchImpl });
      await expect(
        translator.translateBatch(["One.", "Two."])
      ).resolves.toEqual([null, null]);
    }
  });

  it("cancels an unread error body before returning", async () => {
    // A non-200 reply whose body nobody reads holds its connection until it
    // settles; the adapter cancels it so the socket returns to the pool
    // (audit 2026-10-23).
    let cancelled = false;
    const fetchImpl = (async () =>
      ({
        ok: false,
        status: 503,
        body: {
          cancel: async () => {
            cancelled = true;
          },
        },
      }) as unknown as Response) as typeof fetch;
    const translator = createDeepSeekTranslator({ ...CONFIG, fetchImpl });

    await expect(translator.translateBatch(["One.", "Two."])).resolves.toEqual([
      null,
      null,
    ]);
    expect(cancelled).toBe(true);
  });

  it("reports the batch failed when the completion was truncated", async () => {
    // finish_reason "length": the numbered parse would strand a mid-item
    // tail as a permanent miss, so the whole batch reports failed and the
    // orchestrator retries it (audit 2026-10-23).
    const { fetchImpl } = stubFetch({
      content: "1. 天一亮他就醒了。\n2. 海面",
      finishReason: "length",
    });
    const translator = createDeepSeekTranslator({ ...CONFIG, fetchImpl });
    await expect(
      translator.translateBatch(["Mr. Gupta woke early.", "The sea was calm."])
    ).resolves.toEqual([null, null]);
  });

  it("sends one OpenAI-compatible chat request per batch and parses the numbered reply back into aligned translations", async () => {
    const { fetchImpl, requests } = stubFetch({
      content:
        "1. 天一亮他就醒了。\n2. 海面很平静。\n3. 他先写了一个会失败的测试。",
    });
    const translator = createDeepSeekTranslator({ ...CONFIG, fetchImpl });

    const translations = await translator.translateBatch([
      "Mr. Gupta woke early.",
      "The sea was calm.",
      "He wrote a failing test first.",
    ]);

    expect(translations).toEqual([
      "天一亮他就醒了。",
      "海面很平静。",
      "他先写了一个会失败的测试。",
    ]);
    expect(requests).toHaveLength(1);
    const { url, init } = requests[0] as CapturedRequest;
    expect(url).toBe("https://api.deepseek.com/chat/completions");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer sk-test"
    );
    const body = JSON.parse(String(init.body)) as {
      model: string;
      messages: { role: string; content: string }[];
      stream: boolean;
    };
    expect(body.model).toBe("deepseek-flash");
    expect(body.stream).toBe(false);
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0]).toEqual({ role: "system", content: "自然意译。" });
    expect(body.messages[1]?.role).toBe("user");
    expect(body.messages[1]?.content).toContain("1. Mr. Gupta woke early.");
    expect(body.messages[1]?.content).toContain(
      "3. He wrote a failing test first."
    );
  });

  it("marks sentences the reply did not answer for as failed", async () => {
    const { fetchImpl } = stubFetch({
      content: "1. 天一亮他就醒了。\n3. 他先写了一个会失败的测试。",
    });
    const translator = createDeepSeekTranslator({ ...CONFIG, fetchImpl });

    const translations = await translator.translateBatch([
      "Mr. Gupta woke early.",
      "The sea was calm.",
      "He wrote a failing test first.",
    ]);

    expect(translations).toEqual([
      "天一亮他就醒了。",
      null,
      "他先写了一个会失败的测试。",
    ]);
  });

  it("keeps a trailing slash out of the endpoint URL", async () => {
    // The settings page takes the base URL at runtime — a user-pasted
    // trailing slash must not produce a double-slash endpoint.
    const { fetchImpl, requests } = stubFetch({ content: "1. 译文。" });
    const translator = createDeepSeekTranslator({
      ...CONFIG,
      baseUrl: "http://127.0.0.1:3917/",
      fetchImpl,
    });
    await translator.translateBatch(["One."]);
    expect(requests[0]?.url).toBe("http://127.0.0.1:3917/chat/completions");
  });
});

describe("createDeepSeekTranslator failure tolerance", () => {
  const SENTENCES = ["One.", "Two."];

  it("reports every sentence failed on a non-200 reply", async () => {
    const { fetchImpl } = stubFetch({ status: 500 });
    const translator = createDeepSeekTranslator({ ...CONFIG, fetchImpl });
    expect(await translator.translateBatch(SENTENCES)).toEqual([null, null]);
  });

  it("reports every sentence failed when the endpoint is unreachable", async () => {
    const fetchImpl = (async () => {
      throw new Error("connection refused");
    }) as typeof fetch;
    const translator = createDeepSeekTranslator({ ...CONFIG, fetchImpl });
    expect(await translator.translateBatch(SENTENCES)).toEqual([null, null]);
  });

  it("reports every sentence failed on a malformed body", async () => {
    const fetchImpl = (async () =>
      new Response("<html>gateway error</html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      })) as typeof fetch;
    const translator = createDeepSeekTranslator({ ...CONFIG, fetchImpl });
    expect(await translator.translateBatch(SENTENCES)).toEqual([null, null]);
  });

  it("arms the request with a timeout signal and aborts a stuck one at the ceiling", async () => {
    // The controller+setTimeout pair (not AbortSignal.timeout — Chromium
    // 103+ only, older Android WebViews would throw): the stub replies
    // only when aborted, so only the ceiling can end the request.
    vi.useFakeTimers();
    let armed: unknown = null;
    const fetchImpl = ((_url: unknown, init?: RequestInit) => {
      armed = init?.signal;
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new Error("aborted"))
        );
      });
    }) as typeof fetch;
    const translator = createDeepSeekTranslator({ ...CONFIG, fetchImpl });
    const pending = translator.translateBatch(["One.", "Two."]);
    expect(armed).not.toBeNull();
    await vi.advanceTimersByTimeAsync(119_999);
    expect(armed && (armed as AbortSignal).aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toEqual([null, null]);
    vi.useRealTimers();
  });
});

describe("createDeepSeekTranslator reply parsing", () => {
  it("keeps CJK-punctuation numbering and wrapped translations aligned", async () => {
    const { fetchImpl } = stubFetch({
      content: "1、天一亮他就醒了。\n2. 海面很平静，\n一望无际。",
    });
    const translator = createDeepSeekTranslator({ ...CONFIG, fetchImpl });

    const translations = await translator.translateBatch([
      "Mr. Gupta woke early.",
      "The sea was calm.",
    ]);

    expect(translations).toEqual([
      "天一亮他就醒了。",
      "海面很平静，一望无际。",
    ]);
  });

  it("keeps an out-of-range numbered line inside the translation it wraps", async () => {
    // A wrapped translation that continues with "1999. 12 月" must not open
    // item 1999: the text belongs to sentence 1, and sentence 2 keeps its
    // own slot.
    const { fetchImpl } = stubFetch({
      content: "1. 他生于\n1999. 12 月的那个冬天。\n2. 海面很平静。",
    });
    const translator = createDeepSeekTranslator({ ...CONFIG, fetchImpl });

    const translations = await translator.translateBatch([
      "He was born in the winter of 1999.",
      "The sea was calm.",
    ]);

    expect(translations).toEqual([
      "他生于1999. 12 月的那个冬天。",
      "海面很平静。",
    ]);
  });
});
