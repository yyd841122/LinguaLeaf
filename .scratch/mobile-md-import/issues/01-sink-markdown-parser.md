# 01: md 解析器下沉 import-core,server 改引用

**Status:** ready-for-agent

**What to build:** markdown-it 与 md 解析三件套(readMarkdownBook / isMarkdownFilename /
MARKDOWN_EXTENSION)从 server 迁入 `packages/import-core` 并导出;server 删本地模块、
格式注册表改引 import-core、依赖随迁;import-core 补上 md 元素语义的专属单测。完成后
server 的 md 导入端到端行为零变化、全链测试绿。本票无用户可见变化(prefactor:
「先让改动变容易,再做容易的改动」),凭 `npm test` 独立可验证。

**Blocked by:** None (can start immediately).

**验收门**(对应 spec 验收 a;事实基座见同目录 spec.md「现状事实」):

- [ ] import-core 导出 readMarkdownBook / isMarkdownFilename / MARKDOWN_EXTENSION;
      package.json 带上 markdown-it(runtime)与 @types/markdown-it(dev)
- [ ] server 无本地 markdown 模块;格式注册表从 `@lingualeaf/import-core` 引用
- [ ] 新 import-core 测试钉死 spec 决策 5 全部元素语义:标题分章、段落分句、
      code/raw/image 三类 plain 块、行内 md 纯文本化、内嵌 HTML 失活、书名退文件名
- [ ] server format-readers 测试补 markdown 委托断言(经 readUpload 产出
      `format: "markdown"` 即可,不重复语义断言)
- [ ] `npm test` 全绿(pretest 重建语义照旧,禁裸 `npx vitest`)

## Comments

- 2026-11-15 自 spec 拆票(/to-tickets)。流程照 spec「Lane A 管线」六步走,
  不自证清白。
