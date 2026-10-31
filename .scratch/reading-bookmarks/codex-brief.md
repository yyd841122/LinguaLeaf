# Codex 评审委托 — 阅读书签/续读（reading-bookmarks）需求澄清

仓库：/home/youyd/projects/claudeProjects/LinguaLeaf（可只读查阅代码核对以下事实）。
背景：用户最初诉求「加一个书签功能：在看过的地方打个标签，留着下次继续阅读」。经侦察发现自动阅读进度已存在，故本轮澄清围绕「差距与增量」展开。

## 规则（必须遵守）
- **单轮评审**：一次性给出全部结论，不追问、不请求多轮对话。
- **只读分析**：禁止创建、修改、删除任何文件；禁止网络访问。
- 输出中文，结论先行。

## 任务
对【技术决策题 T1–T9】逐题输出五段：**推荐方案 / 原因 / 替代方案 / 潜在风险 / 对 MVP 的影响**（推荐给到文件级落点）。
对【产品决策题 P1–P8】不拍板，只在每题下用 1–2 句评估各选项的技术成本差异（工作量级、被哪条约束卡死），供人类决策参照。
最后加一节：**「你发现被漏掉的技术题 / 与现状或 ADR 的冲突」**。

## 背景事实（已核实，附路径）
1. 两个阅读宿：web（apps/web，React SPA；apps/server，Express + better-sqlite3）与浏览器扩展（apps/extension，MV3，无服务进程 ADR-0006）。共享 packages/import-core（导入链）与 packages/reading-model（阅读前端模型）。
2. **web 自动进度已存在**：表 reading_progress(book_id PK/FK CASCADE, chapter_position, block_position, updated_at)（apps/server/src/schema.ts:67）；GET/PUT /api/books/:id/progress（apps/server/src/books-router.ts:208-266，PUT 校验章/块真实存在）；存取 apps/server/src/book-store.ts:491-524；前端 apps/web/src/readingProgress.ts + progressSession.ts：500ms 防抖自动存、切章/unmount/pagehide(keepalive) 落盘、重开 scrollIntoView 恢复（250ms 恢复守卫）、404=从未读过 / 其他失败=unavailable 不落笔；书卡「读到第 N 章」+ 书名链接落上次章（apps/web/src/BookshelfPage.tsx:220-238）。书架无最近排序（ORDER BY b.id）。
3. **扩展自动进度已存在**：ChapterProgress{chapterIndex, blockIndex}（0-based）+ lastOpenedAt 最近列表（apps/extension/src/store/library-store.ts，namespace "library"，经 namespace-record 串行写队列写 chrome.storage.local）；docId=`doc:${title}` → 重导入原地更新、保留进度。PDF 逐页模式**不记**进度（apps/extension/src/reader/ReaderPage.tsx:253-284）。
4. **不存在**：手动书签（全仓库无）；web 最近阅读排序/区块；GLOSSARY 无「阅读进度/书签」词条（后续补词条）。
5. 锚的本质：块位 = 导入时重建的位置序数（章内 1 起；web DOM 钩子 data-position，扩展 data-block-index 0 起）；无 CFI/字符偏移；原版式不保留（ADR-0001）；导出的标注书文件 = 静态自包含 HTML（ADR-0003），不承载进度。
6. 生命周期：web 删书 → chapters/blocks/reading_progress 级联，word_states（生词本）跨书不删；web 重导入同书 = 新 id（旧进度随旧 id 搁置）；扩展无删除，卸载即清。
7. 已记账待办：saveFailed 跨书不重置；progressSession 未钉住的 Number.isInteger 守卫（.scratch/reading-page-state-machines/issues/01 记录，尚未开票）。

## 硬约束（不可违反）
- 单机单用户本地应用；无账号；本期默认不做同步。
- 服务端 better-sqlite3，.data/lingualeaf.sqlite；迁移走 apps/server/src/schema.ts 的原地模式（CREATE TABLE IF NOT EXISTS + PRAGMA 驱动 addColumnIfMissing + 必要时表重建）。
- SQL 只能住在 apps/server/src/book-store.ts（门禁 apps/server/scripts/check-sql-locality.mjs 的 TABLE_OWNERS）；wire 契约类型共享在 apps/server/src/wire.ts（type-only）。
- web 端 localStorage 被 build 门禁圈死在 apps/web/src/prefs.ts，只放 book 级显示偏好；持久用户状态必须走服务端 API。
- 异步写状态守「属主令牌」不变量（apps/web/src/useOwner.ts，GLOSSARY 词条）；进度读语义 404/失败区分如上，失败不得覆盖真实位置。
- 扩展：无服务进程（ADR-0006），状态只进 chrome.storage.local，经 namespace-record 串行写队列（现两 namespace："vocabulary" / "library"）。
- 阅读模型：句子块为基本单元（GLOSSARY）；web 章路由 /book/:id/:chapter，章内连续滚动。

## 技术决策题（逐题五段输出）
- **T1** web/服务端书签数据模型：新表 bookmarks(book_id, chapter_position, block_position, …) vs reading_progress 加列复用 vs 其他；主键/去重（同块重复打点）/数量上限策略。
- **T2** API 形状：书签是集合型（增/删/列），与进度的单值 upsert 不同——路由谓词集、wire.ts 类型、错误码口径（书不存在/块不存在）、SQL 归属。
- **T3** 锚漂移对策：纯 {章,块} vs 附加内容校验（如存块原文前缀 N 字符，恢复时核对，不匹配则降级到章首或就近块）——web 重导入新 id / 扩展原地更新各自的漂移暴露面；自动进度是否同样受益。
- **T4** 扩展端存储形状："library" 记录内加 per-doc bookmarks vs 新开 namespace；与 0-based ChapterProgress 的对齐；写队列下的批量写成本。
- **T5** 书签跳转/恢复的技术组合：跨章路由跳转 + 块 scrollIntoView 如何与 useProgressSession 的自动恢复、250ms 守卫、属主令牌协作而不互相覆盖；打点动作的异步写归属与失败提示。
- **T6** 进度外显（百分比或「第 N 章第 M 句」）的计算位置：GET /api/books shelf 预计算（需每书总块数：SUM 聚合或冗余列）vs 前端另拉详情计算；对书架查询成本与 wire 契约的影响。
- **T7**（仅当 P3 选「补」）扩展 PDF 模式进度：{pageIndex} 放 library record 何处；与重流式进度字段的关系。
- **T8** 卫生项：reading_progress.updated_at 写而不读（死列）——暴露到响应/删除/不动；saveFailed 泄漏与 unpinned 守卫两笔已记账待办是否并入本期顺手修。
- **T9** 测试落点：server books-router/book-store 测试、web 状态机测试（vitest + jsdom）、扩展 library-store 测试；是否需要 local-e2e（docs/agents/local-e2e.md）或留真机/浏览器验收（docs/agents/browser-e2e.md）——按仓库分工惯例给建议。

## 产品决策题（不拍板，仅评估选项技术成本）
- **P1** 诉求确认：(a) 不知道自动进度 (b) 自动进度有 bug (c) 要手动书签。
- **P2** 书架续读外显：(a) 现状 (b) 更细显示 (c) 显式「继续阅读」按钮 (d) 「最近在读」排序/区块。
- **P3** 扩展 PDF 模式进度缺口：补 / 不补。
- **P4** 书签数量与命名：单签 vs 多签；命名 vs 不命名。
- **P5** 打点/管理入口位置：阅读页顶栏 / 目录面板 / 书卡。
- **P6** 两端范围：web 先行 / 两端各自本地不同步 / 跨端同步。
- **P7** 「从头开始」入口要不要常驻。
- **P8** 手动书签与自动进度的关系：并存各管各 vs 书签覆盖续读目标。

## 输出格式
### T1 <题名>
- 推荐方案：…
- 原因：…
- 替代方案：…
- 潜在风险：…
- 对 MVP 的影响：…
（T2–T9 同构；P 题每题 1–2 句成本评估；最后「漏掉的技术题/冲突」一节。）
