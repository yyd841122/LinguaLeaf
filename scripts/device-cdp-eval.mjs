// 真机 WebView 机检的裸 CDP 客户端:Android WebView 的 CDP 缺浏览器级端点,
// playwright connectOverCDP 连不上(Browser.setDownloadBehavior 不支持),
// 这里直接对 page target 的 WebSocket 说 Runtime.evaluate /
// Page.captureScreenshot。adb forward tcp:9223 localabstract:webview_devtools_remote_<pid>
// 后:EVAL_JS=<file> 或位置参数表达式;SCREENSHOT=<path> 附带截屏。
// 先例:mobile-ipa-buttons 票(2026-11-16)真机双项验证。
import WebSocket from "ws";
import { readFileSync, writeFileSync } from "node:fs";

const port = process.env.CDP_PORT ?? "9223";
const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const target = list.find((t) => t.type === "page");
if (!target) throw new Error("no page target");
const ws = new WebSocket(target.webSocketDebuggerUrl, {
  perMessageDeflate: false,
});
await new Promise((res, rej) => {
  ws.once("open", res);
  ws.once("error", rej);
});

let seq = 0;
const pending = new Map();
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
ws.on("message", (raw) => {
  const msg = JSON.parse(raw);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) {
      reject(new Error(msg.error.message));
    } else {
      resolve(msg.result);
    }
  }
});

const expression = process.env.EVAL_JS
  ? readFileSync(process.env.EVAL_JS, "utf8")
  : `(function(){ return ${process.argv[2] ?? "null"}; })()`;
const ev = await send("Runtime.evaluate", {
  expression,
  returnByValue: true,
  awaitPromise: true,
});
if (ev.exceptionDetails) {
  console.error(
    "page exception:",
    JSON.stringify(ev.exceptionDetails, null, 1)
  );
  process.exit(1);
}
if (process.env.SCREENSHOT) {
  const shot = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(process.env.SCREENSHOT, Buffer.from(shot.data, "base64"));
}
console.log(JSON.stringify(ev.result.value ?? null));
ws.close();
process.exit(0);
