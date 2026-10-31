# reading-bookmarks:阅读书签(web 先行)——手动打点、跳转统一与续读外显

来源:/grill-with-docs 2026-10-31。双 AI 管线:grill 整理(产品题 P1–P8 /
技术题 T1–T10)→ Codex 单轮独立评审(gpt-6.1-sol · read-only · 单轮,
job `review-plan-mvvz6hm9-jyfnq7`,thread
`01a1907b-ef03-7f23-9a2f-da4defcf4382`;委托书 `codex-brief.md`,
报告全文 `codex-review.md`,同目录)→ Claude 合并三处分歧改判 →
维护者拍板「全推荐」(2026-10-31)。三票:01 服务端、02 会话状态机、03 UI 外显。

## 现状(引文已逐字核对,行号对准 2026-10-31 HEAD d1ae168)

- 自动阅读进度**已存在**:表 `reading_progress`(apps/server/src/schema.ts:67,
  book_id 主键/FK 级联,章+块位,updated_at);GET/PUT /api/books/:id/progress
  (apps/server/src/books-router.ts:208-266,PUT 校验章块真实存在);
  存取 apps/server/src/book-store.ts:491-524;web 侧
  apps/web/src/readingProgress.ts(`ReadingProgress {chapter, block}`:6、
  `topmostVisibleBlock()`:50)+ progressSession.ts(useProgressSession,
  250ms 恢复守卫 / 500ms debounce / flush / unavailable 停车 / saveFailed)。
- 书架现状:书名链接落 `progress?.chapter ?? 1`(BookshelfPage.tsx:221),
  meta「读到第 N 章」(:236);无「继续阅读」按钮、无最近排序(ORDER BY b.id)。
- 手动书签全仓库**不存在**;GLOSSARY 无「阅读进度/书签」词条。
- 扩展端(本期零触碰,仅背景):ChapterProgress 0-based +
  lastOpenedAt(apps/extension/src/store/library-store.ts:7);docId=`doc:${title}`
  原地更新;PDF 逐页模式不记进度(ReaderPage.tsx:253)。
- 门禁事实:SQL 门禁 TABLE_OWNERS(apps/server/scripts/check-sql-locality.mjs:19);
  server 测试四层齐备(schema/book-store/api/contract,.test.ts 均在
  apps/server/test/)。

## 范围(本期)

web 端手动书签:服务端存储与 API、阅读会话显式目标通道(跳转统一)、
阅读页打点与目录面板管理、书架「继续阅读」外显。

## 明确排除(本期不做;动其中任何一条先改本 spec)

- 扩展端书签与内容版本机制(P6 后续票;届时书签必须绑内容版本,失配失效禁跳)。
- 扩展 PDF 模式进度(P3;未来若补,先分档「重选文件恢复页码=中」
  「最近列表直接重开=大,须立项」)。
- 百分比与「最近在读」排序(P2 缓;届时百分比走服务端批量聚合+口径定义,
  最近打开≠最近保存、需新事件,不得拿 updated_at 冒充)。
- 书签命名与改名(P4)。
- 跨端同步(动则重开 ADR-0006);CFI/原版式锚(动则重开 ADR-0001);
  标注书文件携带书签(ADR-0003 边界,静态产物不承载应用状态)。
- 「清除进度」语义(P7 只跳转)。

## 决策(锁定,2026-10-31 维护者「全推荐」)

1. **P1=(c)** 手动书签为本期主体;自动进度既有语义零变化。
2. **P6=web 先行**,两端各自本地、不同步。
3. **P4=多签、不命名**;代理主键保留将来加名空间。
4. **T1/T2**:新表 `bookmarks`(代理主键 + UNIQUE(book_id, chapter_position,
   block_position) + created_at,级联删);GET/POST/DELETE 三路由,错误矩阵
   400 / 404 book-not-found / 404 bookmark-target-not-found /
   409 book-not-ready / 409 bookmark-limit-reached;上限常量 100/书,
   超限 409 拒增不淘汰,同块幂等重试返回已有(细目见 01 票)。
5. **T3**:锚 = {章,块},web 零内容校验(web 重导入=新 id,漂移暴露面为零);
   跳转/恢复前校验章块边界。
6. **T5**:progressSession 作唯一恢复/滚动协调者,优先级「显式目标→自动进度→
   章首」,目标带操作标识、章 ready 后消费一次;旧章 flush 与新目标保存定序。
   **本期最高风险,02 先于 03。**
7. **T10**:打点捕获规则分端定义;web = topmostVisibleBlock(),null 禁用,
   不虚构块 1。
8. **P5**:阅读页顶栏打点 + 目录面板管理;书卡管理后续。
9. **P2**:书架显式「继续阅读 · 第 N 章」按钮(更细显示织进按钮文案,
   即拍板项 b+c 合一体);无进度书卡不加按钮(书名链接即入口)。
10. **P7**:「回到第一章」只跳转、不清进度,走显式目标通道(否则会被自动
    恢复拽回旧进度位)。
11. **P8**:并存——书签是标记点集合,进度是现在读到哪;跳到书签后进度照常
    前进(跳转落位写进度),章首播报/章首保存不得覆盖显式目标。
12. **T8**:`reading_progress.updated_at` 留用不删;saveFailed 属主化修复与
    Number.isInteger 守卫钉各自独立 commit。
13. **属主令牌是新增约束不是现状**:progressSession 读目前只有局部取消标记、
    保存反馈无属主裁决;书签读写必须按 GLOSSARY「属主令牌」落实。
14. **事实源**:v1 spec(.scratch/lingualeaf-v1/spec.md)已过时
    (PATCH /progress、导入产译文等),新票以本 spec + 当前代码 + ADR 为准。

## 领域词条(随 01 票落 GLOSSARY.md,文本一字不改)

**阅读进度 (Reading Progress)**:
每本书自动记录的「上次读到」位置(以句子块计):阅读推进即更新,重开一书自动回到该处;每本书至多一条,无需用户操作。
_Avoid_: 书签、足迹、阅读历史

**书签 (Bookmark)**:
用户在阅读中显式打下的位置标记:一本书可以有多枚,可从目录面板跳回、也可删除;与阅读进度各记各的,跳到书签后阅读进度照常向前。
_Avoid_: 标签、收藏、批注

## 红线

- apps/extension/** 零触碰。
- 自动进度既有行为零变化(恢复/保存时机/404=从未读过口径),唯一增量 =
  02 的显式目标通道优先级。
- reading.test.tsx 既有断言零改写(02/03 安全包络)。
- 块含 code/raw/image,任何文案不得称「第 M 句」。
- GLOSSARY 词条一字不改落盘;确认链之外的文档(PRD/ARCHITECTURE/AGENTS.md)
  本期不写。

## 门禁

- 每票每个实现 commit:typecheck && test && lint 绿(看退出码,不看 tail);
  收尾全门禁(npm run verify,含三项 locality check)。
- review 基线钉关系不钉 SHA:各票基线 = 该票首个实现 commit 之前的 HEAD,
  三票各自独立基线、独立双轴评审(Standards + Spec)。
- 收官:票 Comments 记档红绿证据与浏览器验收点,Status 翻 done;
  spec 事实若与代码漂移,按仓库规矩记 Comments 并回改 spec。
