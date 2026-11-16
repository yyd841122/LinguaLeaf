# mobile 续读竞态簇:备份恢复不刷新书架 + listDocuments 不等在途写

**Status:** done

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

- 2026-11-16 Lane A 实现(Codex 审核排队,与 A-1/A-2 同批等配额):
  commit b8cdebd(基线 ef932b4)。namespace-record 增 readSettled(枚举读
  join 写队列尾,捕获时点语义——后续入队的写不延长等待),
  listDocuments/exportProgress 换用;ReaderLanding 导入成功回调 bump
  recentsRevision 重读书架。新测试 2 片(写队列竞争:在途写挂起时读不
  得先 resolve 且 release 后读到新值;导入后书架行 第 1 章→第 3 章),
  变异心证:还原 src 后 2 红精确咬合;全量 verify 108 文件 1207 测试绿。
  附带核过:notes-store 已有同型 pendingWrites join;translation-store
  的 exportAll 仍直读(备份时若有译文写入在途会漏最新行,量级小,暂不
  扩票,留观)。

- 2026-11-16 Codex 审核(threadId 01a1e2bf-6c23-7040-b1f9-cbefe74de1f1,
  基线 ef932b4→b8cdebd):缺陷 2 PASS(探针确认 join 语义);readSettled
  捕获时点语义 PASS;**NO-GO 一项 P2**:error 页也提供备份导入,但
  recents effect 的 empty-only 守卫跳过重读——error 页恢复成功后旧行
  仍可点(评审探针:error 态存 3 章显示/点击仍 1 章)。修于 c7e252a:
  守卫改 `phase !== "empty" && recentsRevision === 0`,导入成功即重读;
  补 error 页恢复回归测试(垃圾 epub 落 error 态 → 恢复 → 第 3 章出现)。
  评审另记(不判 FAIL):ReaderPage 续读仍用列表快照 entry.progress,
  列表读后写入/导入中点击等窗口有旧值面——票面未要求改,留观。

- 2026-11-16 收官翻 done:Codex 审核 2 缺陷 PASS + error 页 P2 修笔在 c7e252a,回归测试+守卫变异咬合,verify EXIT=0。真机人验项各自挂账等机检。
