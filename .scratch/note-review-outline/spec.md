# note-review-outline:笔记复习页——跨书标记大纲,点击回跳段落

Status: ready-for-agent

来源:维护者需求(2026-11-05,reading-notes 收官后第三轮):「所有做过
标记的书,给我显示一个标记的具体大纲展示,我可以点击不同的标记,到相
应的段落位置,方便再次复习。」三题拍板全照推荐:**跨书复习页**(书架
新入口,所有有笔记的书汇一页,按书→按章两级分组)+ **书架角标**(有
笔记的书卡片显示笔记数)+ **条目全文展示**(复习就是要读想法)。

## 现状事实(2026-11-05 编排侧现场取数)

- 路由:react-router v8,仅两面——`/` BookshelfPage、`/book/:id/:chapter`
  ReadingPage(App.tsx);生产 SPA fallback 白名单 `["/",
  "/book/:id/:chapter"]`(frontend.ts:36)——新路由两处都要加。
- 跳转协议:arm-only(hook 内铸 op,页面管导航)是既定决策,且
  jump-target-protocol 票面明文预授权:「jumpTo(arm+navigate 内化)
  不做——**第三个跳转面出现时再评估**」(该票 spec 决策 1)。本票的
  复习页正是第三个跳转面。跨路由显式目标信道今天不存在(全仓无
  useSearchParams/location.state/sessionStorage,探索代理 grep 实证)。
- 页内跳转的落点回执:landedJump.op 与意图 op 对账(ReadingPage
  pendingNoteOpen effect);jumpToNote(ReadingPage.tsx:254-268)展示
  了完整形态:arm → setPendingNoteOpen({bookId, note, op}) → 跨章才
  navigate;书级笔记(chapter/block 为 null)走「展开横幅 + 滚顶」分支。
- 数据面:notes 表锚为 (chapter_position, block_position) 可空对
  (schema.ts:105-119);chapters.title 可 join(schema.ts:43);今日
  listNotes 仅单书(book-store.ts:680-693,CASE 类型固定序);无跨书
  聚合函数;书架 GET /api/books → listShelf(books LEFT JOIN
  reading_progress)(book-store.ts:472-483,books-router.ts:202-204),
  无笔记计数。notes 只会存在于 ready 书(阅读路由守卫),导入中/失败
  书天然无笔记。
- 书架卡片(bookshelf .book-info/.meta 与 continue/export 按钮群,
  BookshelfPage.tsx:218-273):角标挂 .book-info,复习入口挂按钮群邻位。

## 决策(2026-11-05 维护者拍板 3 题 + 编排侧工程裁决 7 条)

1. **跨书复习页**:新路由 `/review`(ReviewPage),所有有笔记的书汇
   一页,按 **书 → 章** 两级分组;每条目:类型徽标(类型色)+ 笔记
   **全文**;只读视图(编辑/删除回阅读器做)。
2. **书架角标**:ready 书卡片显示笔记数角标(noteCount > 0 才显),
   位置 .book-info;书架「笔记复习」入口**常驻**(空态页引导,不做
   条件隐藏——发现性优先)。
3. **全文展示**:条目直接展示笔记全文;超长截断(CSS line-clamp)+
   「展开」切换。
4. **跨路由显式跳转 = 路由参数** `?block=N&note=ID`(工程裁决,即
   jump-target-protocol 预授权评估点的落地形态):arm-only 协议**不
   破**——复习页/书架不 arm,只把目标写进 URL;ReadingPage 挂载时
   useSearchParams 消费:校验整数 → armJumpTarget({chapter: 路由章,
   block: 参数块}) + 以参数构造 pendingNoteOpen 意图(字段依既有
   消费点所需) → **replace 去参**(不进历史,刷新/直开带参同样生效,
   消费即净)。落地回执仍走 landedJump.op 对账,浮层打开复用既有
   pendingNoteOpen effect,不为复习页另开通道。非法/半残参数静默忽略
   并去参。
5. **书级笔记条目**:复习页归入该书分组头部的「文章笔记」子组
   (chapter 为 null),点击跳 `/book/:id/1` 不带参数、不自动展开
   横幅(横幅常驻页顶,维护者自行展开)。
6. **聚合 API**:`GET /api/review/notes`(新 review-router,挂
   app.ts)→ `{ entries: [{ bookId, bookTitle, chapterPosition,
   chapterTitle, note: NoteSummary }] }`,读序 book id → chapter
   position → block position → 类型固定序;SQL 收在 book-store.ts
   (notes JOIN books JOIN chapters;书级行 chapterTitle 用固定占位
   「文章笔记」,chapterPosition 用 0 排最前——join 用 LEFT JOIN
   chapters ON chapter_position)。不做分页(单用户库量级)。
7. **书架载荷**:`GET /api/books` 每书增 `noteCount: number`
   (BookSummary 扩字段;listShelf 聚合子查询或 LEFT JOIN 计数)。
8. **空态**:复习页无任何笔记 → 「还没有笔记;阅读时点句尾的 ✎ 落
   一条。」+ 回书架链接。
9. **GLOSSARY**:新词条「笔记复习 (Note Review)」;本票无新 ADR
   (无架构决策,复用 notes 数据与跳转协议;协议扩展点系前票预授权)。
10. **不做清单**:复习页内编辑/删除、跨书搜索、类型筛选、导出、
    分页。

Lane: **B**(纯 TS/React + SQL,票面自包含;HTTP seam EPERM 假失败
已由 .cc-suite.md 声明,全量测试与 verify 留编排侧补跑)。kernel
(packages/*)零触碰。

## 技术骨架(实现参照,非逐行指令)

- **server**:review-router.ts(GET /api/review/notes);book-store.ts
  新聚合查询 + shelf noteCount 扩展(ShelfEntry/wire 同步);wire.ts
  ReviewNoteEntry 类型与 BookSummary.noteCount;app.ts 挂载。错误码
  形态照既有 coded-body 惯例(本票只读,预计仅 404 兜底)。
- **web**:App.tsx 加 `/review` 路由;frontend.ts:36 fallback 数组加
  "/review";ReviewPage.tsx(← 回书架、两级分组、类型色徽标
  data-note-type、全文 + 展开、跳转 Link 拼装 `/book/${id}/${chapter}
  ?block=N&note=ID`、书级条目 `/book/${id}/1`、空态);BookshelfPage
  角标 + 「笔记复习」入口;ReadingPage 挂载消费 ?block/?note(决策 4
  全语义)。客户端 fetch 走 apps/web/src/api.ts fetchJson 惯例。
- **类型**:wire 为单一来源,web type-only 引入(既有惯例)。

## 验收门

- 测试覆盖:聚合端点真实客户端契约(多书多章、书级条目、排序、空库
  `{entries: []}`、导入失败/导入中书无笔记自然缺席);书架 noteCount
  (0 不显、N 显、非 ready 不显);ReviewPage 渲染(两级分组/全文/
  徽标着色/链接拼装/书级条目/空态);ReadingPage 参数消费(带参挂载
  arm + 跳转落地 + 浮层打开 + **参数被清除**;非法参数静默;无参零
  回归);书签/笔记/目录既有套件零回归。
- 编排侧(caller)补跑 `npm run verify`,以退出码为门(tail 不作数)。
- 评审基线:「本票首个实现 commit 之前的 HEAD」(写关系不写 SHA)。
- **人工浏览器抽验(翻 done 前必做)**:① 书架角标数与实际一致;
  ② 复习页两级分组、全文、类型色徽标;③ 点击跨书条目 → 落到那本书
  那一段且浮层开在那一块(核心场景);④ 书级条目 → 跳第一章;
  ⑤ 复习页空态;⑥ 阅读器不带参直开零回归;⑦ 带参直开/刷新同样跳转
  且地址栏参数被清;⑧ 目录面板笔记跳转零回归。
- 翻 Status 三件套(人工):caller verify 记账、抽验归档 Comments、
  Status 翻 done。

## 挂账候选(不立)

复习页内编辑/删除 · 类型筛选 · 跨书搜索 · 笔记导出(均在
reading-notes 票挂账清单,本票不加新项)

## Comments

### 2026-11-05 立票(编排侧)

- 三题拍板(跨书复习页/书架角标/全文展示)经 AskUserQuestion 落定,
  工程裁决 7 条(参数跳转/聚合 API/书级条目/空态/GLOSSARY/不做清单/
  载荷扩展)由编排侧依现场事实定值;file:line 全部现场取数(探索代理
  引文逐条重验:App.tsx、frontend.ts:36、jump-target-protocol 决策 1
  原文、ReadingPage.tsx:254-268、book-store.ts:680-693、wire.ts:150-162、
  books-router.ts:202-204、progressSession.ts:50-54、schema.ts:39-50)。
- Status 直取 ready-for-agent 理由:全部组件为已验证件复用(跳转协议、
  意图机制、书架卡片、notes 数据),风险集中在参数消费与聚合查询,
  由实现后双轴评审兜底;不另走 review-plan 前置轮。
