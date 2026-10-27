# stale-put-saving-clobber:旧词 PUT 的 finally 清掉新词的在途标记

Status: done

来源:owner-token 收编途中发现的既有问题(.scratch/owner-token/spec.md
Comments,2026-10-27);非该票引入。triage 一轮两决策锁定(2026-10-27,
推荐全收)。单票体量,本 spec 即票。

## 问题

`apps/web/src/WordLookupPopup.tsx` 的 `applyStatus` 用单槽 `saving` 布尔 +
无条件 `.finally(() => setSaving(false))`:词 A 的 PUT 在途时切到词 B 再点
操作,B 的 PUT 起跑后 A settle,finally 把 B 仍在途的 `saving` 清掉——状态
按钮在 B 的 PUT 落地前重新可点(重复提交窗;PUT 幂等,后果轻但标记为错)。
CODING_STANDARDS「Per-entity async UI state keys by entity」的判据
(can two of these run at once?)在此答案为 yes:弹窗常驻挂载
(ReadingPage.tsx:280),切词是同实例换 prop,A/B 两笔 PUT 可同时在途
(wordLookup.test.tsx:710 已造出该场景)。

## 决策(锁定)

1. **saving 按词键控(`Set<string>`)**:即 CODING_STANDARDS 字面写法。
   单槽+时序收口(finally 查 `ticket.stale()`)堵不住两个窗:stale 守卫一
   加,换词 effect 的 `setSaving(false)` 就不能删(B 被 A 的在途卡成永久
   禁用,死锁);effect 重置一在,A→B→A 切回时 saving 已被清零而 A 的 PUT
   仍在途——洞从「换词」挪到「切回」。两窗,单槽堵不全。
2. **条目生死只由各自 PUT 生命周期管**:起跑 `add(key)`,finally 只删自己
   的 key(不清整个集合);换词 effect 不再重置 saving(saveFailed 的换词
   重置保留)。
3. **读侧 = 单字视野读集合一个成员**:applyStatus 重入守卫与按钮
   `disabled` 都读 `savingKeys.has(lemma ?? word)`(key 推导与现
   applyStatus 同式),两层不冲突。附带两个正确行为:同 lemma 的不同词形
   (runs/run)共享一条目——同一服务端词同时只一笔写;切回在途词
   (A→B→A)按钮禁用为真——写仍在途,落地后条目删除按钮自启,与
   useOwner 键比较复活语义(useOwner.ts:19)一致。
4. **零触碰**:`saveFailed` 保持单槽(ticket.stale 守卫+换词重置已封其跨
   词窗,单字视野是其自然作用域);`onStatusApplied` 仍无条件出参
   (owner-token 决策红线);除 `WordLookupPopup.tsx` 外不动源码。

## 回归测试(红验证)

`apps/web/test/wordLookup.test.tsx` 加一条:woke 的 PUT 在途 → 切到 book
→ book 的 PUT 起跑 → woke 先 settle → 断言 book 按钮仍禁用(现状红,修复
后绿)→ book settle → 恢复可点且 pressed 移动。现有「does not patch a
save's verdict onto a word the popup moved to」在修复后语义更直(book 按
钮到站即启用,不再等无关 settle),预期零改写跑绿;「disables the state
row while a save is in flight」单词场景键控等价,零改写跑绿。

## 门禁

review 基线 = 本票首个实现 commit 之前的 HEAD(钉关系不钉 SHA);tdd 于
applyStatus seam 红绿各一片;收尾票 Comments 记档,Status 翻 done。

## Comments

**收官(2026-10-27,实现会话)**:实现 commit 5772005(Claude Code
`/implement`,Opus 5,本机直跑非沙箱)。tdd 于 applyStatus seam 红绿各一片:
钉子测试修前红(woke settle 经 finally 解禁 book 行)、修后绿。门禁:实现
commit pre-commit 全链绿(prettier、四 workspace tsc、eslint
--max-warnings 0、vitest 383 全过、三项 locality check);收尾前
wordLookup 单文件 22/22 与 web typecheck 复跑绿。

- **四决策落法**:saving 单槽布尔改 `Set<string>`,键 = `statusKey(lookup)`
  (lemma ?? word,module 级单一推导,applyStatus 守卫与按钮 disabled 共用
  —决策 3 的「同式推导」由 helper 落实);条目生死随各自 PUT(起跑 add,
  finally 只删自己的 key),换词 effect 的 saving 重置删除,saveFailed 的
  换词重置保留(决策 4 零触碰成立);`onStatusApplied` 仍无条件先行。
  A→B→A 切回在途词行禁用到落地,注释锚 useOwner 键比较复活语义。
- **红验证钉子**:`keeps the new word's row disabled when the previous
  word's save settles first`(woke/book 双 deferred PUT,woke 先 settle,
  断言 book 行仍禁用,再 settle 断言自启且 pressed 移动)。spec 预言成立:
  两既有竞态测试(disables the state row / does not patch a verdict)零改写
  跑绿。
- **双轴 review(review 基线 = 本票首实现 commit 之前的 HEAD,即
  7c43314,钉关系)**:Standards 轴零硬违规,三条 judgement call:
  (1) applyStatus 内重复注释—已删,理由归 statusKey helper 单处承载;
  (2) book PUT stub 正文 `lemma: null` 不符服务端回显(vocab-router.ts:51
  回显请求键)—已改 `lemma: "book"`,两修均 amend 进实现 commit,复跑绿;
  (3) A→B→A 再入行禁用行为仅注释承载、无测试钉—按 tracker
  约定落 needs-triage 存根票(.scratch/popup-saving-comeback-pin/spec.md),
  不在本票搭车。Spec 轴零代码发现,四决策逐条核对符合,scope creep 仅
  statusKey helper 与注释(服务决策 1/3),唯一缺口即本收官记档,随本
  commit 补上。
