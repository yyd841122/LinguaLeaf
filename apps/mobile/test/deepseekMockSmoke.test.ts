/* eslint-disable no-restricted-globals */
// This suite is a Node-context integration test living in the mobile
// suite: it spawns the repo's committed mock over loopback and allocates
// a port — genuinely Node-only work (process.execPath, process.cwd()),
// which is why the browser-source rule is suspended for this one file.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import {
  createDeepSeekTranslator,
  DEFAULT_TRANSLATION_STYLE_PROMPT,
} from "../src/translate/deepseek";
import { translateSentences } from "../src/translate/batch";

// The ticket's mock-smoke gate (mobile-app ticket 04): the ported adapter
// drives the repo's committed OpenAI-compatible mock over real loopback
// sockets — percent steps visibly per batch, every sentence lands
// aligned, and no request ever leaves 127.0.0.1. The unit suites pin the
// adapter's failure tolerance against stubbed fetch; this one proves the
// real wire shape (real HTTP, real numbered reply, real parser).
//
// jsdom rewrites import.meta.url away from the file scheme, so the repo
// root is found through cwd candidates (the vitest root is apps/mobile;
// invocation cwd may be the repo root or the workspace).
const MOCK_RELATIVE = resolve("scripts/local-e2e/mock-deepseek.mjs");
const MOCK_SCRIPT = [
  MOCK_RELATIVE,
  resolve(process.cwd(), "../../scripts/local-e2e/mock-deepseek.mjs"),
].find((candidate) => existsSync(candidate));

describe("DeepSeek mock smoke (loopback, zero real calls)", () => {
  let child: ReturnType<typeof spawn>;
  let baseUrl: string;

  beforeAll(async () => {
    if (!MOCK_SCRIPT) throw new Error("mock-deepseek.mjs not found from cwd");
    // The mock echoes its ARGUMENT in its banner (not the bound port), so
    // the test allocates a free port itself and hands it over.
    const port = await new Promise<number>((resolve, reject) => {
      const probe = createServer();
      probe.once("error", reject);
      probe.listen(0, "127.0.0.1", () => {
        const { port } = probe.address() as { port: number };
        probe.close(() => resolve(port));
      });
    });
    child = spawn(process.execPath, [MOCK_SCRIPT, String(port)], {
      stdio: ["ignore", "pipe", "inherit"],
    });
    baseUrl = await new Promise<string>((resolve, reject) => {
      let buffered = "";
      child.stdout!.on("data", (chunk: Buffer) => {
        buffered += chunk.toString();
        // The mock announces itself: "mock DeepSeek on 127.0.0.1:<port>".
        const match = buffered.match(new RegExp(`127\\.0\\.0\\.1:${port}`));
        if (match) resolve(`http://127.0.0.1:${port}`);
      });
      child.once("exit", (code) =>
        reject(new Error(`mock exited early (${code})`))
      );
      child.once("error", reject);
    });
  });

  afterAll(async () => {
    child.kill("SIGTERM");
    await sleep(50);
  });

  it("translates a 25-sentence chapter in two visible batches", async () => {
    const sentences = Array.from(
      { length: 25 },
      (_, i) => `Sentence ${i + 1}.`
    );
    const steps: string[] = [];
    const translations = await translateSentences(
      createDeepSeekTranslator({
        apiKey: "smoke-key",
        baseUrl,
        model: "deepseek-flash",
        stylePrompt: DEFAULT_TRANSLATION_STYLE_PROMPT,
        // The vitest jsdom env mixes realms: the global fetch is Node's
        // undici, whose brand check rejects the jsdom AbortSignal the
        // adapter's timeout controller builds — a test-env artifact (the
        // real WebView is one realm). The timeout contract is pinned by
        // the adapter unit test; this smoke validates the wire.
        fetchImpl: (input, init) => {
          const { signal: _dropped, ...rest } = (init ?? {}) as RequestInit;
          void _dropped;
          return fetch(input, rest);
        },
      }),
      sentences,
      (done, total) => steps.push(`${Math.round((done / total) * 100)}%`)
    );

    // Percent stepped visibly: one step per batch (20 then 25 of 25).
    expect(steps).toEqual(["80%", "100%"]);
    // Every sentence came back, aligned by number. The mock numbers its
    // canned replies per request, so the second batch (sentences 21-25,
    // numbered 1-5 in its own prompt) maps back onto positions 1-5 —
    // exactly the per-batch renumbering the alignment contract demands.
    expect(translations).toEqual(
      sentences.map((_, i) => `译文第${(i % 20) + 1}句`)
    );
  });
});
