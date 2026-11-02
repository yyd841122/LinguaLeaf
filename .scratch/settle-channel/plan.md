# settle-channel(落回裁决通道)— 设计评审稿

状态:grilling 第二轮待拍(Q6-Q9)+ 第一轮已定(D1-D5)。
本稿是 Codex 架构评审的输入;评审通过并经维护者拍板后,升格为 spec-as-ticket(spec.md,循 status-join 形)。

## 0. 问题

「陈旧异步响应不得写状态」不变量由属主令牌(GLOSSARY)承载;但令牌只共享「陈旧与否」的裁决,
整条**落回裁决**(GLOSSARY 新词条)——陈旧整包丢弃 / 新鲜失败起旗 / 新鲜成功清旗并应用——
在 web + reading-model 5 处手抄、扩展宿 2 处以非令牌土法实现,共 7 处(第 8 处见 §1 排除项)。
本周期每一笔边界政策修复(b99b8a3 invalidate-at-arm、db63724 saveFailed 属主化)
改的正是这条散在多文件的线:no locality——bug 不在任何单个模块内部,在「模块如何被调用」。
(评审纠错记档:35ff6d7 系测试 stub 纪律修复,非生产裁决,不计入生产证据。)

## 1. 七处现场(2026-11-02 逐一核实)

| # | 站点 | 位置 | 形状与增量 |
|---|------|------|-----------|
| 1 | bookmarksSession.settleOp | apps/web/src/bookmarksSession.ts:47 | 文件内最完整的通道形:(op, ticket, onFresh?) ⇒ 陈旧丢/失败旗/成功清+apply;列表 effect 开始处内联清旗,建/删 op 不清 |
| 2 | chapterTranslation.start | apps/web/src/chapterTranslation.ts:65 | arm 清旗 + mark;成功再清旗并 apply;409 与其他失败同落 catch 起旗 |
| 3 | taskFollower.tick | apps/web/src/taskFollower.ts:50 | 私有 useOwner()(:34)逐 tick mark;cancelled 布尔旗护拆除竞态;旗生命周期 = follow 开始清 + 新鲜成功清,**逐 tick 不清**;陈旧 tick 成败皆弃 |
| 4 | progressSession.flushSave | apps/web/src/progressSession.ts:125 | 票据外携(arm 铸、ref 存,可 null);成功只清旗不 apply;从不在开始清旗 |
| 5 | WordLookupPopup.applyStatus | packages/reading-model/src/react/WordLookupPopup.tsx:115 | 「先落页后验陈旧」(popup-status-backedge 决策 3):onStatusApplied 先于陈旧检查; savingKeys 在途键控 + finally 释放 |
| 6 | ReaderPage.reopenDocument | apps/extension/src/reader/ReaderPage.tsx:325 | 非令牌:reopenSeq 计数器——慢 A 不得覆盖已选 B |
| 7 | ReaderPage 词状态 bulk read | apps/extension/src/reader/ReaderPage.tsx:349 | 非令牌:cancelled 旗 + merge-wins(已有键胜);失败静默(着色是 best-effort) |

**排除项**:ReaderPage.tsx:415 restoreRef(一次性引用 consume-once)不是落回裁决,不收。

消费方:ReadingPage.tsx(#1/#2/#4/#5)、BookshelfPage.tsx(#3)、ext ReaderPage(#5/#6/#7)。

## 2. 已定决策(grilling R1,维护者已拍板)

- **D1 范围**:上表 1-7 一次收齐(含 ext 两处土法);排除项不动。
- **D2 形状**:react hook「裁决通道」放 packages/reading-model/src/react/——旗归通道持有;
  ext 已依赖 reading-model/react(共享弹窗),无新依赖。reading-model 根入口不放
  (check:react-locality 门禁:根入口禁 import react、禁 re-export 子入口符号)。
- **D3 「先落页后验陈旧」升一等钩子**:`onLanded`(不验陈旧、无条件应用)与
  `onFresh`(凭票裁决)并列,缺省同钩——它是普适规则不是弹窗怪癖。
- **D4 测试**:packages/reading-model/src/testing/ 新设裁决竞态套件工厂(循 wordLookupRaceSuite
  先例):共享主张写一遍,各站点传真通道各跑一遍;各站「应用逻辑」主张留在原测试文件。
  **本票明说非零改写**:裁决主张类用例从 bookmarksSession.test(11 it)/progressSession.test
  (24 it)/useOwner.test(153 行)等迁出合并,改写是票的目标本身。
- **D5 术语**:GLOSSARY「落回裁决 (Settling)」词条已落盘(属主令牌之后)。

## 3. 待拍问题(R2,附建议与依据)

- **Q6 arm 清旗语义**
  - A:run 默认清旗 + 轮询站 opt-out 开关;
  - B(建议):通道只保证两条凭票裁决写入(新鲜失败→起旗、新鲜成功→清旗);
    意图侧清旗 = 显式 `settle.clear()` 一行,留在各站 arm 处(#1/#2/#3/#5),#4 flushSave 保持零清。
  - 依据:逐 tick 清旗会让 outage 旗闪烁、建/删 op 起旗多出眨眼——两处行为漂移;
    裁决写入单源已达成目标,arm 清旗是意图声明不是裁决。
- **Q7 taskFollower `cancelled` 退役**:拆除竞态改 teardown invalidate 私有令牌
  (#3 owner 私有已核实:useTaskFollower 内 useOwner(),与 chapterTranslation 的
  useOwner(bookId, chapterNumber) 互不相干);对外 surface {outage, invalidate} 不变。
- **Q8 命名**:`useSettle()` ⇒ `{ failed, clear, run }`;
  `run<T>(op, { onFresh?, onLanded?, ticket? })`;套件 `settleRaceSuite`。
  票据外携支 #4(flushSave 的 arm 铸、ref 存票据)。
- **Q9 落地**:spec-as-ticket(`.scratch/settle-channel/spec.md`,循 status-join 形)
  → Codex 沙箱实现 → 双轴评审(Spec/Standards)→ 收官 docs。

## 4. 约束与边界

- 行为预算:Q6(B)下逐站旗语义 byte 级不变;唯一例外 #6/#7 的机制替换
  (seq/cancelled → 令牌)语义等价、对外不可见。
- 服务器零涉;纯 web + ext + reading-model。
- CODING_STANDARDS.md「Cleanup flags revoke once」等裁决条目落地后回指通道。
- 沙箱假失败:HTTP-seam 测试 listen EPERM 系沙箱限制,验证以 typecheck + lint + 非 HTTP 测试为准。
- 现场取数纪律:本稿行号/形状已核,实现时仍须重读现场,禁转抄。

## 5. 验收草案(粗,升格 spec 时细化)

1. 通道 + 套件工厂 + 7 处迁移;全链 typecheck/lint 绿、非 HTTP 测试绿。
2. 套件主张(每站传真通道各跑):陈旧成功不写状态 / 陈旧失败不起旗 /
   新鲜失败起旗 / 新鲜成功清旗并应用 / onLanded 先于裁决 / #4 票据外携 /
   #7 merge-wins 保留。
3. ext 双宿各跑套件(循 wordLookup 竞态套件双宿先例)。
4. #3 的 cancelled 消失,teardown invalidate 等价性有测试。
5. GLOSSARY 已落;CODING_STANDARDS 回指随票。
