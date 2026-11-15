# 01: md 解析器下沉 import-core,server 改引用

**Status:** ready-for-human

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
- 2026-11-15 实现收官(commit 48fa73c):三件套迁入 packages/import-core/src/markdown.ts
  并导出;markdown-it(runtime)+ @types/markdown-it(dev)随迁,server 摘两行依赖;
  format-readers.ts 改引 import-core;本地模块删除。新 test/markdown.test.ts
  10 测试钉死 spec 决策 5 全部元素语义,期望值全部现场跑 markdown-it 15 +
  extractChaptersFromHtml 取得(两处反直觉实测:紧列表各 li 并入一条 paragraph
  run;链接段落保文字丢 href)。server format-readers 补 markdown 委托断言。
  server md 端到端零变化:epub-import + api 55 测试绿;全套件 107 文件 1184 绿。
- 2026-11-15 Codex read-only 审核(threadId 01a1df75-57b4-7692-94a3-70c3cd998549):
  本票验收门 4/5 PASS、npm test 门 PARTIAL(审核只读跑不了测试,实现侧全绿输出
  在案,门本体由 caller verify 兜底);变异心证表逐行全绿,零证据缺口;期望值
  溯源未见错。verdict NO-GO 因票 02 人检点未跑,与本票代码无关。
- 2026-11-15 内置双轴 review(ef2188a...HEAD):Spec 轴零缺失零错实现;唯一
  spec 偏差 = 委托断言多断 title/chapters 两行——裁定保留:它们钉的是注册表
  utf8 适配器本身(传对文件名、不丢章节),非 md 语义重复。Standards 轴本票
  范围零发现。
- 状态翻 ready-for-human:待 caller 显式补跑 `npm run verify`(与票 02 共用
  同一步),过后随收官 docs commit 翻 done。
