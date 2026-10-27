# stale-put-saving-clobber:旧词 PUT 的 finally 清掉新词的在途标记

Status: ready-for-agent

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
