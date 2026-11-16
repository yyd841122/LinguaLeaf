# mobile 续读竞态簇:备份恢复不刷新书架 + listDocuments 不等在途写

**Status:** needs-triage

来自 mobile-app 02 独立终审发现 1+2(2026-11-16,threadId
01a1e1db-a5d2-75f0-9f2f-1c7b4accd86b,verdict NO-GO;两案同属「重开续读
拿到旧进度」):

1. `ReaderLanding.tsx:136`:备份导入成功回调只 setBusy/setSummary,
   不重读 recents;`ReaderPage.tsx:377` 按旧 `entry.progress` 续读 →
   「恢复到第 3 章 → 直接打开仍在第 1 章」(票 05 引入的回归)。
2. `library-store.ts:144`:`listDocuments()` 直读 `record.read()`,
   不等在途写入;快速返回书架可能读到旧位置并用于续读(终审只读探针
   复现写 `{1,2}` 在途时读得 `{0,0}`)。

修法方向:恢复成功后重读列表(或打开时取最新进度);读操作等待此前
写入完成(join 写队列或版本戳);补竞争测试。

## Comments

- 2026-11-16 立票。代码站点已现场核验(备份回调无刷新;直读在途写)。
