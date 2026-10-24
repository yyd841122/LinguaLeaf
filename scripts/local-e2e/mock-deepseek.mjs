// OpenAI-compatible mock of the DeepSeek chat endpoint, for local E2E only:
// answers each /chat/completions with one numbered 「N. 译文」 line per
// numbered input line (the numbered-line parser in translate/deepseek.ts),
// 200ms per call so percents visibly step and two chapter tasks genuinely
// overlap. Loopback-only; no external call ever leaves the machine.
//
//   node scripts/local-e2e/mock-deepseek.mjs [port]   # default 3917
//
// Point the server at it with shell env (shell shadows .env; the env-guard's
// shadow warning is the confirmation):
//   DEEPSEEK_BASE_URL=http://127.0.0.1:3917 DEEPSEEK_API_KEY=x
// The full driver discipline lives in docs/agents/local-e2e.md.
import { createServer } from "node:http";

const port = Number(process.argv[2] ?? 3917);
const server = createServer((req, res) => {
  if (req.method !== "POST" || !req.url.includes("/chat/completions")) {
    res.writeHead(404).end();
    return;
  }
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    setTimeout(() => {
      const user = JSON.parse(body).messages.find((m) => m.role === "user");
      const count = (
        String(user?.content ?? "").match(/^\s*\d+\s*[.、)：:]/gm) || []
      ).length;
      const content = Array.from(
        { length: count },
        (_, i) => `${i + 1}. 译文第${i + 1}句`
      ).join("\n");
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          choices: [
            { finish_reason: "stop", message: { role: "assistant", content } },
          ],
        })
      );
    }, 200);
  });
});
server.listen(port, "127.0.0.1", () =>
  console.log(`mock DeepSeek on 127.0.0.1:${port}`)
);
