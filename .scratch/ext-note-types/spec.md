# ext-note-types:扩展笔记四类型(EPUB+PDF 面一起,照抄 web 分类集)

Status: ready-for-agent(2026-11-06 clarify 管线收官:grill 三题 +
review-plan 评审合并 + 拍板单两题(布局页签 / 迁移归进度)全照推荐
拍定。前置:pdf-notes 真机抽验通过后才开工)

来源:pdf-notes 真机抽验当日(2026-11-06)维护者提出「现在的笔记没有
之前加的 4 个分类」。web 端四类型(进度/感受/思路/疑问)自 v1 即有;
扩展端单类型系 extension-notes 拍板 2 有意裁剪(「书级文章笔记本期不
纳入」+单类型),pdf-notes 继承项照抄。本票把类型带回扩展侧。

Lane:B(纯 TS/React、票面自包含、沙箱内可验证;grill 时即定,编排
侧可翻)。

## 现状事实(2026-11-06 编排侧现场取数,评审复核后)

- **web 四类型**:`NOTE_TYPES = ["progress","feeling","idea","question"]`
  (apps/server/src/wire.ts:151-155),标签 进度/感受/思路/疑问
  (apps/web/src/NotePanels.tsx:11-14)。web 编辑器是 **tablist 页签 +
  单选字段**:panels 按 type 键控存四份草稿(NotePanels.tsx:23-52),
  渲染 `role="tablist"` 页签只显示 selectedType 一个字段(:128-133)。
- **EPUB 扩展存储**(apps/extension/src/store/notes-store.ts):
  `ReaderNote = {docId, chapterIndex, blockIndex, text}`(:7-12),
  唯一性按三字段锚(:25-30 sameAnchor),无 type 字段;限额
  NOTE_TEXT_LIMIT=10,000 / NOTES_PER_BOOK_LIMIT=100(:19-20);
  record `{version:1, notes:[]}`(:21-22)。
- **PDF 扩展存储**(apps/extension/src/store/pdf-notes-store.ts):
  `PdfNote = {docId, page, lineIndex, lineText, text}`(:11-17),
  唯一性按三字段锚(:36-40),无 type;限额从 notes-store 单源
  import(:1);record `{version:1, notes:[]}`。
- **两个 decode 都拒绝重复锚、且只收已知字段**:notes-store decode
  对 `sameAnchor` 重复条目抛「笔记存储损坏」(notes-store.ts:60-63),
  push 时只挑 docId/chapterIndex/blockIndex/text 四字段(:64-69)——
  附加 `type` 字段会被剥掉;pdf-notes-store decode 同构
  (pdf-notes-store.ts:56 起)。未知版本与畸形记录显式抛错。
- **串行队列边界**(apps/extension/src/store/namespace-record.ts):
  `read()` 在 writeQueue 之外裸读(:31-35),`update()` 是唯一
  「队列内读新-改-写」通道(:40-45)。decode 无写能力;队列外快照
  落盘会覆盖并发保存。
- **NoteEditor 现契约**(apps/extension/src/reader/NoteEditor.tsx):
  锚无关 props——ownerKey/ariaLabel/`initial: T|undefined`/
  button/`store: {save(text), delete()}`(:30-34);单一 busy 标志
  (:42);固定宽浮层(POPUP_WIDTH_PX,:150);空文本禁存、显式删除、
  限额 role=alert、dirty requestClose proceed-gate(:53)。
- **宿主按锚整体替换**:EpubChapter `committed(anchorIndex, note)`
  经 run/patch 用结果替换该锚状态(EpubChapter.tsx:52-56);
  PdfReader `onCommitted` 同构,commit-filter 按锚过滤后追加
  (PdfReader.tsx:334-338)——锚唯一 today,四类型下会吞兄弟类型。
- **PDF 按钮态**:has-note 亮标要求 `note.lineText === lineText`,
  drift 行按钮 disabled(防覆盖)(PdfReader.tsx:250-253);读失败
  saved===null 全灰。
- **扩展跨包引用**:tsconfig include 仅 src/test/config
  (apps/extension/tsconfig.json:11);web 引 wire 是 **type-only**
  (wire.ts 头注:每个 web 引用都 `import type`,bundle 零服务端代码)。
- **GLOSSARY 现状**:EPUB 句明写「单类型自由文本」、PDF 句明写
  「每行一条」(GLOSSARY.md:102-103)——加类型后两句都要改写。

## 决策(2026-11-06 维护者拍板;评审后并轨)

1. **范围 = EPUB+PDF 两个面一起**:两 store + 一编辑器同票改,避免
   形状漂移。
2. **分类集 = 照抄 web 四类**:progress/feeling/idea/question,中文
   标签 进度/感受/思路/疑问,同词同序。
3. **语义 = 每锚点每类型一条(web 同款)**:同一锚点每类型最多一条,
   删除按类型显式。**布局 = 页签切换**(2026-11-06 拍板单确认):
   tablist 四页签 进度/感受/思路/疑问,单选字段——web 同款交互,
   固定宽浮层不挤,与现单字段结构同构。
4. **旧笔记迁移 = legacy v1 条目默认归 progress**(2026-11-06 拍板
   单确认);v2 条目必须带合法 type,不享受默认。

## 工程裁决(review-plan 合并后定稿)

- **a. 存储形状 v2**:两 store record 升 `version:2`,条目加 `type`;
  唯一性锚扩为四字段(锚三字段+type)。升版理由(评审 6 修正):
  v1 解码**拒绝重复锚**且**剥掉附加字段**——既容不下同锚多类型,
  也保不住单条的类型信息,身份维度必须升版承载,而非「附加字段」。
  decode 纪律:v2 读 v1(条目无 type → 归 progress,仅此默认);
  v2 条目缺 type、type 不在 NOTE_TYPES、同锚同 type 重复 → 抛错且
  存储原样保留(评审 5);未知版本照旧抛错。
- **b. 类型单源 = 直接 import**:extension 直接引 NOTE_TYPES/NoteType
  自 `apps/server/src/wire.ts`(评审 7 实测:现配置可编译、浏览器
  打包仅四常量、wire 出口全 type-only;票面原稿「需 tsconfig/vite
  各放行一行」说法有误已删)。实现时以扩展真实构建复核;无配置改动。
- **c. 迁移纪律(评审 4)**:迁移落盘**只经 `update()` 串行队列**:
  全 namespace 一次转换(多书齐迁,互不丢)、写失败保留原样下次
  重试、无记录零写;**禁止**在裸 `read()` 快照上落盘。读路径允许
  内存内 v1→v2 视图转换(不落盘),持久化推迟到下一次成功 mutation
  或显式迁移步(实现会话二选一并测试钉死)。
- **d. NoteEditor 四类型契约(评审 3/8)**:`initial` 集合化(该锚
  全部类型笔记数组),`store.save(type, text)/delete(type)`,
  `onCommitted(type, noteOrNull)` 类型化回传;每类型独立
  draft/busy/失败/成功反馈,同类型内防重入,跨类型互不阻塞、一类型
  成功不清他类型失败;dirty = 任一类型变脏;requestClose proceed-gate、
  关页丢稿、owner token 语义不变。
- **e. 宿主替换按 锚+类型(评审 3)**:EPUB/PDF 双宿主 commit 处理
  改为只替换该锚该类型条目,兄弟类型保留;「reload 前兄弟仍在」
  测试钉死。
- **f. PDF 按钮决策表(评审 9)**:按谓词计算与条目序无关——
  无笔记=无亮标可点;存在匹配条目=亮标;存在 lineText 不符条目=
  按钮 disabled + drift 提示(沿用「已保留原笔记,未回挂不符条目」);
  亮标、disabled、提示三者独立断言。读失败语义分层不变。
- **g. 限额语义不变**:正文 ≤10,000/条、每书 ≤100 条跨类型合计,
  超额失败留稿照旧。
- **h. 边界不变**:浮层仍扩展本地(不引 web NotePanels,数字 ID/
  notesSession 深耦合,extension-notes 裁决④继续有效);web 零触碰
  (wire 只读);kernel 零触碰(✎ 与 has-note 无类型概念);
  manifest 零新增权限。
- **i. GLOSSARY 改写(评审 2)**:EPUB 句改「落在句子块上,每句子块
  每类型一条」;PDF 句改「落在行上,每行每类型一条」;保留纯本地
  与永不出现在 web /review 两句。

## 实现顺序(评审 10 修订:回归证据前移)

1. 类型单源 + 两 store v2 + 迁移:对抗 fixture(v1→progress 幂等、
   同锚四类型共存、v2 缺/非法 type 与重复键抛错留原样、迁移写失败
   重试不吞他书)+ 异步隔离先行(评审 10);
2. NoteEditor 四类型化(页签切换)+ EPUB 宿主接线(锚+类型替换、
   兄弟保留)+ readerNotes.test.tsx 扩(评审 10 点名);
3. PDF 宿主决策表 f + 回挂校验扩展 + pdfReaderNotes.test.tsx 扩;
4. 限额/读失败/脏确认回归 + 窄窗冒烟(浮层滚动/焦点)提前;
5. GLOSSARY + smoke 多类型断言 + 编排侧 verify + 真机检查点。

## 验收骨架(自验清单,评审后扩)

同一锚四类型各一条互不覆盖、单类型删除兄弟保留(reload 前后)、
旧笔记升级归 progress 零丢失且幂等、迁移写失败重试不吞他书、v2
缺/非法 type 与重复键抛错存储原样、每类型独立 busy/失败不串、
一类型成功不清他类型失败、dirty 四类型确认、Esc proceed-gate 不变、
PDF 决策表三态独立、读失败可见禁编辑可重试、限额 100/书跨类型
合计超额留稿、EPUB/PDF 两面零回归、点词键盘与音标零回归、窄窗
浮层滚动焦点可用、web /review 与扩展存储互不见、manifest 零新增
权限。

## Comments

### 2026-11-06 grill(编排侧,AskUserQuestion 三题)

- 三题全照推荐拍定:EPUB+PDF 一起 / 照抄 web 四类 / 每类型一条
  web 同款。Lane B 即时选定。
- 关联票:pdf-notes(前置,已实现待真机抽验;本票在其验收通过后
  开工,避免真机基线漂移)。

### 2026-11-06 review-plan(NEEDS REVISION 10 发现,已合并)

- job `review-plan-mw51xrzk-ui0qko`,threadId
  `01a1b132-629b-7612-9212-40cd89af3134`,gpt-6.1-sol/high/
  read-only。评审自述以内存 TS 探针验证过 wire 直引与浏览器打包。
- 编排侧承重引文逐条现场核验:**10/10 属实零虚构**,其中两处
  推翻票面原稿说法,已当场修正:①评审 6——v1 decode 对重复锚抛
  「笔记存储损坏」且 push 只挑四字段(notes-store.ts:60-69),原稿
  「旧代码会按 sameAnchor 去重静默吞并 3 条」不准,升版理由改为
  「拒重复锚+剥附加字段」;②评审 7——wire.ts 出口全 type-only、
  直引无需配置改动,原稿「需各放行一行」已删。
- High 3 条合并:评审 3 → 裁决 d(契约集合化+类型化回传)与
  裁决 e(宿主按锚+类型替换、兄弟保留钉死);评审 4 → 裁决 c
  (迁移只经 update() 队列,禁队列外快照落盘)。Medium 7 条:
  评审 1 → 决策 3 布局待拍板(页签 vs 堆叠;评审核实 web 是
  tablist+单选字段,票面「四字段同屏」系误述);评审 2 → 裁决 i;
  评审 5 → 裁决 a(v2 恶意形状抛错留原样);评审 8 → 裁决 d
  (每类型独立反馈);评审 9 → 裁决 f(决策表);评审 10 → 实现
  顺序前移回归证据 + readerNotes.test.tsx 点名 + 窄窗冒烟提前。
- 拍板单余两题:布局形态(推荐页签:web 同款交互延续、固定宽浮层
  四字段会挤、与现单字段结构同构改动最小)、迁移默认 progress
  确认。
EOF
echo done

### 2026-11-06 维护者拍板单确认(终审)

- 拍板两题全照推荐:布局 = 页签切换(决策 3 落定);旧笔记迁移默认
  归「进度」(决策 4 落定)。评审 Open 三题全部关闭:Q1 升 v2(裁决
  a)、Q2 直引 wire(裁决 b)、Q3 归 progress(决策 4)。
- 前置门:pdf-notes 真机抽验通过后开工,避免真机基线漂移。
- Status 翻 ready-for-agent,随立票 commit 入档。
