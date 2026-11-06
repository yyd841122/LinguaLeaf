# pdf-notes:扩展阅读器 PDF 面笔记(重选回挂,行级,离线本地)

Status: ready-for-agent(clarify 管线收官:grill 两轮七题 + review-plan 评审合并 +
拍板 3 修订已确认(2026-11-06),同日翻 ready-for-agent。评审 
ready-for-agent)

来源:extension-notes 收官当日(2026-11-06)票面点名的后继票。
clarify 管线:grill 两轮七题(重开体验/落点/错挂保护/页码恢复/范围
分票/多本互存/空态提示)全按推荐落定 → 票面起草 → Codex review-plan
单轮评审(gpt-6.1-sol/high/read-only,job
`review-plan-mw4rcarn-2uq0nl`,threadId
`01a1b022-cfb3-7e51-8d4e-af1bb94ab589`)verdict NEEDS REVISION
14 发现(7 P1/7 P2),编排侧逐条现场核验全属实,合并后本文为定稿
候选(差异:拍板 3 修订,见决策 3 与 Comments)。

## 现状事实(2026-11-06 编排侧现场取数,评审修订后)

- **PDF 面纯会话级**:`phase: "pdf"` 状态 = `{title, session:
  PdfSession, page, scale, lookup}`(ReaderPage.tsx:68-76),整个
  ReaderState 只活在组件 state;`openPdf(bytes, filename)` 从文件字节
  起加载(pdf.ts:45-61),`PdfSession = {doc: PDFDocumentProxy, title,
  pageCount}`(pdf.ts:16-20)不持有字节——重开扩展即失,页码固定从
  1 起(ReaderPage.tsx:185-191)。library 是 EPUB 专属(ExtBook,
  `docId = doc:${book.title}` ReaderPage.tsx:197)。
- **标题来源**:PDF 元数据 Title,否则文件名去 `.pdf`(pdf.ts:49-61)。
- **「行」是渲染现成分段**:`renderPdfPage` 逐 `content.items` 渲染,
  每个非空、含词的 TextItem 是一行(空 item `trim()===""` 与无词
  item 在 pdf.ts:188-196 被跳过);`segmentLine` 把 item.str 按
  WORD_PATTERN 切词(pdf.ts:101-125),词按 `tx[4]/tx[5]` 坐标原位
  叠加。行索引身份须按同一「跳过后零基」规则计数。
- **渲染串行化与 token**:renderQueue 单链(pdf.ts:91 声明,136-143
  链接),步内 token 比对丢弃 stale 应用(pdf.ts:175-182)——但 token
  只护渲染步、无导航侧失效,不护笔记读/回挂/持久化(评审 6)。
- **会话清理先例**:scanned 拒收时 `destroyPdf(session)`(ReaderPage
  .tsx:177-181),重开 EPUB 时对 PDF session 亦有 destroy(:431-434)
  ——新增取消/失败路径须同款显式清理(评审 5)。
- **空态已有「最近文档」架头**(ReaderPage.tsx:577-587):EPUB
  recents 列 `{entry.title} 第 N 章`;文件入口单一
  `accept=".epub,.pdf"`(ReaderPage.tsx:593-600)。
- **notes-store v1**(apps/extension/src/store/notes-store.ts):
  `NoteAnchor = {docId, chapterIndex, blockIndex}`(:7-11);限额
  `NOTE_TEXT_LIMIT = 10_000` / `NOTES_PER_BOOK_LIMIT = 100`(:19-20);
  validAnchor(:24-32);decode:version:1 校验已知字段,**接受附加
  字段**,未知版本与畸形记录显式抛错(:41-75,原文「v1 accepts
  additive fields」)。EPUB 锚语义与 PDF 无对应物。
- **指纹先例**:extension-notes 的 `book-fingerprint.ts` 归一化纪律
  (NFC + 换行归一,`sha256-v1:` 前缀);detectScanned 头部页抽样
  (sampleTextLengths 默认 pages=3,pdf.ts:64-81)。
- **既有测试的几何盲区**:readerPage.test.tsx:1064-1086 mock
  renderPdfPage 用假 span——行按钮几何/清理断言须走浏览器冒烟
  (apps/extension/scripts/smoke.mjs)或真机。
- **配额**:chrome.storage.local 总配额 10MB,无 unlimitedStorage;
  PDF 字节 MB 级,原书字节进现有 storage.local 不可行(免重选另票)。

## 决策(2026-11-06 维护者两轮拍板 7 题;拍板 3 经评审修订待再确认)

1. **重开体验 = 重选回挂**:重开扩展后重选一次 PDF,笔记回挂、恢复
   页码;原书字节不持久化。免重选(IndexedDB/OPFS)另票。
2. **笔记落点 = 行级**:行 = 非空且含词的 TextItem(与渲染同一计数
   规则),每行一条可编辑笔记。词级太碎、页级太粗,选区级另票。
3. **【评审修订,待确认】错挂保护 = 字节身份精确化,确认门消解**:
   原「指纹+确认+迁移」的前提(前缀指纹身份)被评审 1/2/7 推翻——
   前缀指纹可让同头异尾两本撞身份、迁移无契约、稀疏笔记匹配率不可
   靠。修订为:**docId = `pdf:sha256-v1:<整文件字节摘要>`**(开文件
   即得,先于 pdf.js 解析);同一文件 → 同身份 → 静默回挂;不同文件
   → 不同身份 → 各归各,零确认零迁移。拍板 3 的保护目标(永不静默
   删除、不错挂)由身份精确化直接达成:不存在原地替换面,异版旧笔
   记留在旧身份下、重开原文件即回。「同书异版迁移」将来想要另票。
4. **阅读位置恢复 = 每身份一份位置记录**:`{docId, page, scale}` KB
   级,回挂任意身份时恢复其位置(不止最近一本);空态提示只显示
   最近会话(评审 12 的调和)。
5. **范围分票**:本票 = 重选回挂 + 行级笔记 + 身份/回挂 + 位置恢复
   + 空态提示;不含原书持久化、选区级、迁移、扩展内列表/复习面。
6. **多本 PDF 各归各**:身份为字节摘要,互不干扰;历史身份笔记不可
   达但不删除(无列表面的诚实代价,继承不做清单)。
7. **空态记忆提示**:最近一次 PDF 会话记录,空态仿「最近文档」形态
   显示「《title》第 N 页——选同一个文件继续」,与 EPUB recents
   并存;纯提示不可点开。

继承项(照抄 extension-notes 拍板):草稿生命周期(dirty 同一道
「放弃修改?」、关页丢稿、失败留稿重试);空文本禁存 + 显式删除;
限额 10,000/100;纯本地、web `/review` 永不见;单类型无 type 字段。

## 工程裁决(评审合并后定稿)

- **a. 存储契约**:独立 `pdf-notes-store.ts`(独立 namespace record,
  复用 createNamespaceRecord + version 纪律 + memory 注入测试)。
  锚 = `{docId, page, lineIndex}`,记录另存 `lineText` 供回挂校验。
  decode 纪律照抄 v1 语义(校验已知字段、接受附加字段、未知版本抛
  错)。**读失败 ≠ 无笔记**:笔记记录读失败走可见失败态禁编辑可
  重试(EPUB 宿主 EpubChapter.tsx:47-81 同构);位置/提示记录读失
  败按缺失降级(写失败亦良性,提示是便利非数据)。无笔记不落笔记
  record(零垃圾);位置/提示 record 独立于笔记 record。
- **b. 身份**:字节摘要 sha256-v1(开文件即算,先于解析);标签
  `pdf:` 前缀(book-fingerprint 同款 branded 约定,本次直接裸串+
  常量,branded type 仍是 types-alignment 记档项)。
- **c. 回挂与决策表**(身份先行,评审 13 的顺序修正):
  | 打开文件摘要 | 该身份笔记记录 | 行为 |
  |---|---|---|
  | 命中已有 | 有 | 静默回挂全部 + 恢复 `{page, scale}`;行全文校验不符的条目不静默删(理论不可能,同字节抽取确定;若现即为 drift 记档) |
  | 命中已有 | 无 | 空书;首次存笔记才落 record |
  | 未命中 | — | 新书各归各,零确认;空态提示替换为本次会话 |
  | 任意 | 读失败 | 可见失败态禁编辑可重试 |
  笔记读/回挂/持久化的迟响应由 kernel owner token + settle 裁决
  (open/回挂/笔记读/编辑各立 owner,失效时机显式;评审 6:渲染
  token 不护这些面,不越权宣称)。
- **d. 会话所有权**:候选 session(已 openPdf 未确认身份前)显式
  持有,取消/失败/放弃即 destroyPdf,成功后才移交 state(评审 5;
  与 scanned 拒收先例同构)。
- **e. 编辑浮层契约**:NoteEditor 锚无关化——owner key、store 最小
  接口、aria 标签全部 props 化;PDF 面供 aria「行笔记」(评审 8:
  现 hard-code EPUB 锚字段与「句子块笔记」NoteEditor.tsx:34-40,
  150)。PDF overlay 清理选择器扩至含笔记控件(现仅
  `[data-pdf-word]`,pdf.ts:180-182),笔记控件自带 data 属性;
  zoom/音标行重建 overlay 后由 settled 笔记态重贴按钮。
- **f. 规范行提取单一源**:eligible-line 判定(非空、含词、跳过规
  则、NFC 归一)抽单一函数,渲染/锚定/回挂校验共用,防三方漂移
  (评审 11)。
- **g. 零回归与零触碰**:点词键盘与音标叠加、EPUB 面全部、词汇状态
  零回归;web/server/kernel 零触碰;manifest 零新增权限;GLOSSARY
  补 PDF 例外句(锚词「行」,不冒充「句子块」)。

## 实现顺序(评审 13 修正:身份与决策表先行)

1. 身份(字节摘要)+ pdf-notes-store + 决策表测试(对抗 fixture:
   同头异尾两本必不同身份)+ 读失败可见纪律;
2. 行锚定:规范行提取单一源 + 行尾 ✎ + overlay 清理契约;
3. 回挂(同身份静默)+ 每身份位置记录 + owner/settle 迟响应;
4. 浮层接线(NoteEditor 锚无关化)+ 生命周期继承;
5. 空态记忆提示 + GLOSSARY 例外句 + 收尾回归(浏览器冒烟补几何/
   键盘/清理断言,编排侧 verify,真机检查点)。

## 验收骨架(自验清单,评审 14 扩)

同一文件重选静默回挂笔记与页码缩放、A→B→A 各归各互不扰且各自恢复
位置、同头异尾 fixture 必不同身份零确认、取消打开路径 session 零泄
漏、无笔记书零笔记 record、行尾按钮仅文本行、zoom/音标行重建后按钮
与亮标仍在、点词键盘与音标叠加零回归、EPUB 面零回归、笔记读失败可
见禁编辑可重试、dirty 确认/关页丢稿/超额留稿、空态提示与 EPUB
recents 并存、重开扩展提示仍在、限额 10,000/100 失败留稿。

## Comments

### 2026-11-06 grill 两轮(编排侧)

- 七题全按推荐落定:重选回挂/行级/指纹+确认/页码恢复/范围分票/
  各归各/带记忆空态。第二轮三题(分票/多本互存/空态提示)由第一
  轮答案解锁。

### 2026-11-06 review-plan(NEEDS REVISION 14 发现,已合并)

- job `review-plan-mw4rcarn-2uq0nl`,threadId
  `01a1b022-cfb3-7e51-8d4e-af1bb94ab589`,gpt-6.1-sol/high/read-only。
- 编排侧承重引文逐条现场核验:14 条全属实(抽样=头 3 页
  pdf.ts:64-67;renderQueue:91、token 不护导航侧;scanned/onReopen
  destroy 先例;NoteEditor hard-code 锚与 aria;decode 接受附加字段
  ——票面原措辞「只收已知形状」系错误已改;测试 mock 假 span 几何
  盲区)。评审一处路径不精:`scripts/smoke.mjs` 实为
  `apps/extension/scripts/smoke.mjs`。
- P1 合并:①前缀指纹身份推翻 → 拍板 3 修订为字节身份精确化、确认
  门与迁移整条消解(待维护者确认);②A→B→A 迁移优先级 bug、③迁移
  契约、⑦匹配率不可靠、⑩决策表缺分支 → 随迁移消解一并关闭,决策
  表改为身份版三行;④读失败语义 → 裁决 a 分层(笔记可见失败/位置
  提示良性降级);⑥渲染 token 不越权 → 裁决 c owner/settle 显式;
  ⑬顺序 → 身份与决策表先行。P2 合并:⑤会话所有权 → 裁决 d;
  ⑧浮层边界 → 裁决 e(锚无关化 + aria props + 清理选择器);
  ⑨引文漂移与 decode 措辞 → 现状事实区全部改正;⑫恢复范围
  → 拍板 4 改每身份位置记录 +「零记录」限定为笔记 record;⑭验收
  扩(同头异尾 fixture、zoom 重建、冒烟几何/键盘/清理、verify 与
  真机检查点)。

### 2026-11-06 维护者拍板单确认

- 拍板 3 修订确认(「确认修订」):字节身份精确化、确认门与迁移消
  解、异版旧笔记不可达但永久保留、迁移另票。
- 报备项无异议:拍板 4 精化(每身份位置记录)、拍板 6 机制落地
  (字节摘要)、「零记录」限定笔记 record。
- 票面 Status 翻 ready-for-agent,随立票 commit 入档。
