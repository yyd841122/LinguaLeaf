# 02 · 409 家族加盖与 500 打嗝钉

Status: ready-for-agent

## Scope

- `apps/server/test/contract.test.ts`:
  - 既有 409 测试(同一 gated-import 门上)加盖断言,使名字
    "reading routes" 与断言一致:章内容与导出(downloadAttachment)在
    importing 期间 409——downloadAttachment 走 !ok 抛错路径,不触 DOM,
    无需浏览器 stub;TOC 实测不守 respondIfNotReady(200 + 空
    chapters),按 pinned-not-endorsed 钉住;progress 既有断言不动;
  - wordLookup describe 新增打嗝钉:stack 词典 close(实例 close 顶替为
    no-op 护住 afterEach 的二次 close),console.error 就地 spy,
    fetchWordLookup 必须抛 ApiError(500, body {error: "internal server
    error"}),不得读成 null。
- 只动 contract.test.ts;其余零改动。

## Gate

`npm run typecheck && npm test && npm run lint` 绿;随后 `npm run verify`
全绿(看退出码)。

## Comments

