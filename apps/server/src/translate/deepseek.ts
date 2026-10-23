import type { Translator } from "./translator.js";

// Server-side configuration (spec: key、基地址、模型名走服务端 .env 配置):
// DEEPSEEK_API_KEY, DEEPSEEK_BASE_URL, DEEPSEEK_MODEL, and the style
// prompt (DEEPSEEK_TRANSLATION_PROMPT) all come from the environment, so
// operators can point the adapter at any OpenAI-compatible endpoint and
// retune the translation stance without touching code.

// The built-in translation stance (spec: 自然意译、学习者友好). Operators
// override it wholesale with DEEPSEEK_TRANSLATION_PROMPT.
export const DEFAULT_TRANSLATION_STYLE_PROMPT = [
  "你是资深的文学译者，把英文句子翻译成自然、地道的简体中文，供中国的英语学习者对照阅读。",
  "逐句意译：按中文的表达习惯重组句子，不逐词直译、不生硬欧化；忠实原意，保留原句的语气与语域。",
  "人名、地名等专有名词保留英文原文；已有通行中文译名的除外。",
  "只输出译文，不加任何解释、引号或前后缀。",
].join("");

export type DeepSeekConfig = {
  apiKey: string;
  baseUrl: string;
  model: string;
  stylePrompt: string;
  // Test seam: the HTTP boundary of the adapter. Defaults to global fetch.
  fetchImpl?: typeof fetch;
};

// Reads the DeepSeek settings from the given environment (process.env by
// default). Returns null when no API key is configured: the caller then
// imports without a translator, exactly like running with an empty
// dictionary — books import, translation lines stay empty.
export function deepSeekConfigFromEnv(
  env: Record<string, string | undefined> = process.env
): DeepSeekConfig | null {
  const apiKey = env.DEEPSEEK_API_KEY?.trim();
  if (!apiKey) return null;
  return {
    apiKey,
    baseUrl: env.DEEPSEEK_BASE_URL?.trim() || "https://api.deepseek.com",
    // deepseek-flash: the served workhorse name since deepseek-chat's
    // 2026-07-24 retirement (api-docs.deepseek.com/updates) — audit
    // 2026-10-23.
    model: env.DEEPSEEK_MODEL?.trim() || "deepseek-flash",
    stylePrompt:
      env.DEEPSEEK_TRANSLATION_PROMPT?.trim() ||
      DEFAULT_TRANSLATION_STYLE_PROMPT,
  };
}

// The wire protocol: sentences go out as a numbered list, the reply must
// come back with the same numbering, and alignment is by number — never by
// position. Any sentence the reply does not answer for stays failed (null)
// so the batch orchestrator retries it (spec: 带失败重试).
function buildBatchPrompt(sentences: string[]): string {
  return [
    "请把下面编号的英文句子逐句翻译成简体中文。",
    "要求：输出的编号与输入一一对应，每行格式为「编号. 译文」；译文独占一行，不要换行、不要加引号。",
    "",
    ...sentences.map((sentence, index) => `${index + 1}. ${sentence}`),
  ].join("\n");
}

// Numbered-line parser: a line like "3、译文" (the model sometimes swaps in
// CJK punctuation) opens item 3; a plain continuation line belongs to the
// previous item, because long translations may wrap.
function parseNumberedReplies(
  content: string,
  expectedCount: number
): Map<number, string> {
  const replies = new Map<number, string>();
  let openItem: number | null = null;
  for (const line of content.split("\n")) {
    const numbered = /^\s*(\d+)\s*[.、)：:]\s*(.*)$/.exec(line);
    if (numbered) {
      const item = Number(numbered[1]);
      // Only a number inside this batch opens an item. A wrapped
      // translation that continues with "1999. 12 月..." must stay part of
      // the sentence it wraps, not steal a slot or strand its tail here.
      if (item >= 1 && item <= expectedCount) {
        openItem = item;
        replies.set(item, (numbered[2] ?? "").trim());
        continue;
      }
    }
    if (openItem !== null && line.trim().length > 0) {
      replies.set(openItem, `${replies.get(openItem) ?? ""}${line.trim()}`);
    }
  }
  return replies;
}

type ChatCompletionResponse = {
  choices?: { message?: { content?: unknown }; finish_reason?: string }[];
};

// The DeepSeek adapter: one translateBatch call is one OpenAI-compatible
// chat completion against `${baseUrl}/chat/completions`. Per the Translator
// contract it never throws — an unreachable endpoint, a non-200 reply, or a
// malformed body reports every sentence of the batch as failed.
export function createDeepSeekTranslator(config: DeepSeekConfig): Translator {
  const fetchImpl = config.fetchImpl ?? fetch;
  const endpoint = `${config.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  return {
    async translateBatch(sentences) {
      if (sentences.length === 0) return [];
      let content: string;
      try {
        const response = await fetchImpl(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${config.apiKey}`,
          },
          body: JSON.stringify({
            model: config.model,
            stream: false,
            messages: [
              { role: "system", content: config.stylePrompt },
              { role: "user", content: buildBatchPrompt(sentences) },
            ],
          }),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        if (!response.ok) {
          // An unread error body keeps its connection until it settles;
          // cancel it so the socket returns to the pool (audit 2026-10-23).
          await response.body?.cancel().catch(() => {});
          return sentences.map(() => null);
        }
        const payload = (await response.json()) as ChatCompletionResponse;
        const choice = payload.choices?.[0];
        // Only a settled completion parses: "length" (truncated) or any
        // other non-stop reason can end mid-item, and the numbered parse
        // would strand the tail — report the batch failed so it retries
        // whole (audit 2026-10-23; widened in verification).
        if (
          choice?.finish_reason !== undefined &&
          choice.finish_reason !== "stop"
        ) {
          content = "";
        } else {
          // Only a string parses: numeric/object content in valid JSON is a
          // broken reply, handled on the all-failed path instead of throwing
          // past the catch (audit 2026-10-23).
          const rawContent: unknown = choice?.message?.content;
          content = typeof rawContent === "string" ? rawContent : "";
        }
      } catch {
        return sentences.map(() => null);
      }
      const replies = parseNumberedReplies(content, sentences.length);
      return sentences.map((_, index) => replies.get(index + 1) ?? null);
    },
  };
}

// One chat completion can think for a while on a 20-sentence batch; two
// minutes covers DeepSeek's slow tail without pinning a stuck connection.
const REQUEST_TIMEOUT_MS = 120_000;
