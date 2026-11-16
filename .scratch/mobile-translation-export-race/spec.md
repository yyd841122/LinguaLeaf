# mobile 译文导出读不 join 写队列(备份窗口漏最新行)

**Status:** needs-triage

来自 mobile-progress-stale-reopen 收官顺带核验 + A-5 Codex 评审纪律提醒
(2026-11-16;Comments 记录不符合 tracker 另票纪律,立此 stub):

- `translation-store.ts` 真实后端的 `exportAll()`/`getChapter()` 直读
  `record.read()`,不 join 写队列。备份导出(手机侧 buildBackup 的
  translations 段)恰逢译文写入在途时,读到上一拍快照,漏最新落定行。
  library-store 同款病已修(listDocuments/exportProgress 换
  readSettled,commit b8cdebd)——本票决定是否同修 translation-store
  的两个读点,及是否顺查其余 namespace-record 消费面
  (bookmark-store 的 list、pdf-notes-store 的 list)。

量级评估:译文写入为章任务批量落定,导出撞在途窗口窄;但零成本
可修(readSettled 已存在)。触发条件:备份导出功能使用 + 章任务在途。

## Comments

- 2026-11-16 立票 stub。
