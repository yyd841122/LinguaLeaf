# ext-reuse-convergence: 扩展侧两处复用收敛(review 判定 call 存档)

Status: needs-triage

来源:extension-reader 票 07 双轴 review 的 Standards 轴(2026-10-28),两条
Duplicated Code 判定 call,当时不阻塞收官、留作收敛候选。

## 候选一:标注 walk 并入共享 seam

apps/extension/src/reader/import-book.ts 的 ExtBlock/ExtChapter/ExtBook 重声明
服务端形状,assembleBook 重走服务端 buildChapterBlocks 的同构 walk。ipa-line/
IpaLookup seam 已在 @lingualeaf/import-core,标注 walk 可搬到 seam 旁,两宿一份。

## 候选二:chrome 后端命名空间读写小助手

vocabulary-store.ts 与 library-store.ts 各自手写「整命名空间读-改-写」+ 同一段
单写者注释;一个 namespace-record 助手可收敛。
