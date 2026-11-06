# extension-notes:扩展阅读器笔记(EPUB 面先行,离线本地)

Status: ready-for-agent

来源:维护者题目(2026-11-06,note-review-outline 收官次日):「扩展/PDF
表面的笔记」。clarify 管线收官:grill 四题 → Codex 单轮评审(NEEDS
REVISION,13 发现,threadId 01a1af30-5437-7672-ac16-544648f8cb3e)→
编排侧合并(2 条 P0 事实错误修正、承重引文现场核验)→ 4 题拍板全照
推荐(2026-11-06 维护者「全确认」)。

## 现状事实(2026-11-06 编排侧现场取数,Codex 复核修正后)

- **扩展零笔记代码,但 kernel 已有笔记挂点**:`apps/extension/src`
  全文 grep `note` 零命中;而 reading-model kernel 的 react 层已有
  `BlockNoteControl`(exists/disabled/onClick)+ `NoteButton`
  (✎ 段尾按钮,`block-note-button has-note` 亮标,aria 编辑笔记/写
  笔记),`AnnotatedBlockView` 对 sentence/code/raw/image 全部块型
  提供挂点(packages/reading-model/src/react/annotated-blocks.tsx:22
  -38)——扩展从未传入 noteControl 而已。按钮 UI 是共享的;缺的只是
  扩展侧的存储、编辑浮层与接线。
- **EPUB 面与 web 同构**:ReaderPage 用 kernel `AnnotatedBlockView`
  逐 block 渲染(ReaderPage.tsx:465);ExtBook =
  `{title, chapters: [{title, level, blocks}]}`(import-book.ts:29),
  章与块有零基索引;宿主混渲句子块与 code/raw/image 块。
- **书身份是标题字符串**:`docId = \`doc:${book.title}\``
  (ReaderPage.tsx:184);`saveDocument` 接口注释「Insert or replace
  by id; an existing document keeps its progress」(library-store.ts:
  22),chrome 实现原地替换、保留 lastOpenedAt 与进度
  (library-store.ts:105-112)。改名即新身份;异书同名即撞身份。
- **同名替换与 web 语义相悖**:web 侧 ADR-0007 明文「重导入创建独立
  新书,不迁移笔记,原书及其笔记保留」;扩展同名重导入是**原地替
  换**——若新书内容变化,同 `(docId, chapterIndex, blockIndex)` 会
  指向别处,旧笔记**静默错挂**且可被继续编辑覆盖,比进度偏移(自
  可见、自纠正)更刺眼。本票以内容指纹保护修正(决策 4)。
- **PDF 面是会话级**:`phase: "pdf"` 只活在组件 state
  (ReaderPage.tsx:66,172),不进 library——扩展重开即失。pdf.js 原
  位覆盖渲染(词按坐标摆,无 block 流),扫描版拒收(pdf.ts
  detectScanned)。⇒ PDF 笔记另票;该票先定「重开体验」(免重选?
  保留原位?)再选字节/文本存储策略——「必须先持久化原书」是设计
  选择而非现状必然。
- **存储 seam**:chrome.storage.local(library-store.ts:19-20「数据
  自决:卸载即清」;vocabulary-store.ts:104 同构 namespace record,
  队列是每实例一条写路径,跨实例并发无保证——namespace-record.ts
  )。manifest permissions `[contextMenus, storage, tabs]`,无
  `unlimitedStorage`——**10MB 是全部 storage.local 总配额**,书库
  (EPUB JSON 含逐词音标,无数量上限)、进度、生词本与笔记共享;
  超额写入拒绝 Promise。
- **web 笔记(对照面)**:四类型 NOTE_TYPES(progress/feeling/idea/
  question)在 server wire(wire.ts:151);NotePanels(web 本地组件,
  NotePanels.tsx:2-7 import server wire)与四类型循环、数字 ID、
  NoteSummary、notesSession 操作结果深耦合——去 import 不等于得到
  单类型编辑器;浮层宿主另有 NotePopup.tsx。web 空文本禁存
  (`disabled={!panel.text.trim()}`,NotePanels.tsx:210)、删除走显
  式 DELETE(books-router.ts:520)。web notes 表锚
  `(book_id, chapter_position, block_position, type)`(schema.ts:
  105-118);ADR-0007 定限额:正文 ≤10,000 字符、每书 ≤100 条。
- **领域文档口径**:GLOSSARY「笔记」词条是四类型口径、书级笔记名
  「文章笔记」——本票随实现补扩展侧例外一句(单类型、无书级)。

## 决策(2026-11-06 维护者拍板 4 题全照推荐 + grill 基础 4 题 + 工程裁决 5 条)

1. **数据归属:纯本地自决**。chrome.storage.local,与服务器零连接,
   无同步无导出;web `/review` 永不见扩展笔记(合 ADR-0006)。
2. **范围分票:本票只做 EPUB 面**。PDF 面连同其持久化前置另票,该
   票先定重开体验;EPUB 不等 PDF。
3. **单类型自由文本**。无类型标签页;持久化形状显式定版(版本字段
   + 兼容读取原则),未来加类型是产品决策,不预埋 type 字段。
4. **同名替换保护**(拍1):重导入同名书时对 ExtBook 内容取指纹
   (chapters/blocks 归一化哈希);内容相同 → 照旧静默原地替换;内
   容不同 → 拦下确认(「新书内容与原书不同,替换将使 N 条已有笔记
   错位,继续/取消」),取消则不导入。指纹存 library 记录,进度同
   享此保护。
5. **记录基数**(拍2):落点仅句子块,每落点一条可编辑笔记;code/
   raw/image 不出按钮;书级「文章笔记」本期不纳入;空文本禁存、显
   式删除按钮(与 web 行为同构)。
6. **草稿生命周期**(拍3):同 web——dirty 时切章/切书/关浮层走与
   Esc 同一道「放弃修改?」确认;关扩展页丢弃未存稿;失败态留稿可
   重试。
7. **限额**(拍4):正文 ≤10,000 字符/条、每书 ≤100 条(照抄
   ADR-0007);超额写入失败 → 可见失败态留稿;本期不加
   unlimitedStorage。
8. **不做清单**:扩展内笔记列表/轻复习面本期不做(笔记只经阅读页
   段尾按钮可达;有需求另票);web 面零触碰;kernel 零触碰(挂点
   已存在,只接线)。

工程裁决(编排侧拍,实现须遵守):

- **a. 存储契约**:独立 `notes-store.ts`(独立 namespace record,
  memory 实现可注入测试),不塞进 LibraryStore;单一写者串行更新;
  读失败可见(alert,区别于「无笔记」);写成功才落「已存」态。
- **b. 生命周期实现**:迟响应由 owner token + settle(kernel 现成)
  裁决;弹层按笔记落点重挂(同 web「弹窗按 op 重挂」形态)。
- **c. 配额失败面**:超额/写失败统一走可见失败态,保留草稿文本。
- **d. UI 接线**:块级笔记按钮直接接 kernel `NoteButton`(has-note
  亮标免费);编辑浮层是扩展本地单类型小组件,不搬 NotePanels(类
  型循环/数字 ID/notesSession 深耦合,为单类型消费者先抽共享接口
  不值;将来多消费者再抽);按钮/浮层样式扩展 reader.css 自带一份
  并注明来源。
- **e. 锚点词汇**:笔记落点 = 句子块,索引用 `chapter.blocks` 零基
  全体索引;票面与文案用「句子块」不用含混的「段尾」。

## 实现顺序(评审 12 的顺序建议)

1. notes-store.ts + memory 注入实现(存储契约与失败验证先行);
2. library 同名替换指纹保护(决策 4,动 saveDocument 语义);
3. 最小编辑闭环(kernel NoteButton 接线 + 单类型浮层 + 生命周期);
4. 限额与超额失败面;
5. GLOSSARY 例外句 + 收尾回归(词汇状态零回归)。

## 验收骨架

同名同内容静默替换、同名不同内容被拦且取消不导入、重开扩展笔记仍
在(持久化)、超额失败留稿可见、dirty 切章/切书确认、关页丢稿、切
章后迟响应不落错浮层、浮层定位与键盘可达、code/raw/image 无按钮、
词汇状态与进度零回归。

## Comments

### 2026-11-06 clarify 第一轮(Codex review-plan)

- 评审:NEEDS REVISION,13 发现(2 P0 / 6 P1 / 5 P2),threadId
  `01a1af30-5437-7672-ac16-544648f8cb3e`,job
  `review-plan-mw4hvpax-ge86z7`,gpt-6.1-sol/high/read-only。
- P0 修正:kernel 并非零笔记概念(annotated-blocks 已有
  BlockNoteControl/NoteButton);library-store 引文错位已改指 L22/L105。
- Top3 风险:静默错挂 > 手写文本丢失 > 共享组件返工;全部落入决策
  4 / 工程裁决 a-c / 工程裁决 d。
- 「索引稳定」「余量无忧」等推论不随引文成立,已从事实区移除,改由
  决策 4(指纹)与决策 7/工程裁决 c(限额与失败面)承担。

### 2026-11-06 维护者拍板

- 四题全照推荐(「全确认」):拍1 同名替换保护(指纹+确认)、拍2
  仅句子块每落点一条无书级、拍3 草稿生命周期同 web、拍4 限额
  10k/100 照抄 ADR-0007。
- 「不做清单」里的「扩展内笔记列表本期不做」系编排侧按 grill 第一
  轮推荐(仅阅读时可达)落定,维护者拍板时未见异议,随票执行;要改
  在本票开工前提出。
