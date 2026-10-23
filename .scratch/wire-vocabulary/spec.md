# 导入状态的 wire 词汇:文案不是契约

来源:architecture-review-20261022 候选 4(Worth exploring · in-process)。
报告行号基于 book-store 落地前的 main;本 spec 的锚点是重定位后的。

## 问题

- web 用 `error.body?.error === "加密 PDF 暂不支持"` 区分「加密 PDF 的 400」和
  「其它 400」——中文展示文案被当成 machine-readable 契约,服务端改字即静默降级
  (BookshelfPage.tsx 上传 catch 分支)。
- `BookStatus`、`ImportStage` 两套 union 两侧手抄(server: book-store.ts 声明;
  web: BookshelfPage.tsx:7 本地副本);stage 标签 map 用 `Record<string, string>`
  + `?? "处理中"` 兜底,新增 stage 漏标是静默的。
- 413 的响应体是 multer 的原始 `{ error: "LIMIT_FILE_SIZE" }`;web 对超限文件
  显示「请重试」——重试永远不会成功。

## 方案

错误体带稳定 code + 文案;两套 union 进一个两侧 import 的共享 module——
server 持值、web 持标签/文案映射;契约测试钉住「每个 stage 有标签」。

- `apps/server/src/wire.ts`(新,types-only):`BookStatus`、`ImportStage`、
  `ImportErrorCode`、`ImportRejection`。book-store.ts 改为从这里 import。
- 上传拒绝体:`{ code, error } satisfies ImportRejection`——router 里 code
  字面量拼错 = 编译错。覆盖 415 / invalid-epub / invalid-pdf / encrypted-pdf /
  scanned-pdf / file-too-large(新,413)。
- `apps/web/src/importCopy.ts`(新,web 侧展示词汇):`Record<ImportStage, string>`
  stage 标签 + `Record<ImportErrorCode, string>` 上传错误文案 + 两个组装函数。
  Record 全量键 → 新增 union 成员漏标 = web 编译错。BookshelfPage 只消费这个
  module,上传 catch 改按 code 取文案。
- 契约测试(contract.test.ts):上传拒绝全家桶断言 code;store 直写每个 stage
  经真实客户端读回,钉「每个 stage 有标签」。

## 决策

1. **共享 module 落在 `apps/server/src/wire.ts`,不开新 workspace package。**
   server 持值——契约的权威就是 server;contract.test.ts 已有跨 app import web
   源码的先例(双方 tsconfig 各自兼容)。候选 2 的 `packages/reading-model`
   面向跨层运行时规则(词边界 pattern 等),与本候选的 wire 词汇是两件事,不提前
   拖入包构建机制。
2. **wire.ts types-only。** web 侧全部 `import type`,vite 构建产物零 server
   代码,tsc(产线)也不在运行时触碰它——不需要给包加构建步骤。
3. **web 的两个运行时兜底保留并钉为 pinned behavior**(CODING_STANDARDS
   「Reviews pin unreachable behavior」):stage 未知 → 「处理中」、code 未知 →
   「请重试」。共享类型下不可达,但 `books.import_stage` 是无 CHECK 的 TEXT 列,
   守卫是信任边界上的最后一道;测试注明「pinned, not endorsed」。
4. **413 升格为 `file-too-large` code + 正确文案**(「文件超过 20MB 上限」),
   修掉误导性的「请重试」。这是唯一的行为增强,已在此声明。
5. 行为微变:无 code 的 400/415(web 视角)从「文件无法解析」落到通用「请重试」
   ——本 server 的常规 4xx 全带 code(两侧同 build 发布,仅部署错配可达);
   仍无 code 的例外是非尺寸类 multer 拒绝(如 LIMIT_UNEXPECTED_FILE,任何
   multipart 字段名不对的非 web 客户端都能触发),web 侧落决策 3 的「请重试」
   兜底。

## 门禁

每个实现 commit:`npm run typecheck && npm test && npm run lint` 绿(看退出码,
不看 tail);收尾 `npm run verify` 全绿。契约套件在同一 commit 内扩展
(CODING_STANDARDS:「extend that suite in the same change」)。
