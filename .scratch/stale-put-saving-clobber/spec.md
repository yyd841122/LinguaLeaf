# stale-put-saving-clobber:旧词 PUT 的 finally 清掉新词的在途标记

Status: needs-triage

来源:owner-token 收编途中发现的既有问题(.scratch/owner-token/spec.md
Comments,2026-10-27);非该票引入。

## 问题

`apps/web/src/WordLookupPopup.tsx` 的 `applyStatus` 用单槽 `saving` 布尔 +
无条件 `.finally(() => setSaving(false))`:词 A 的 PUT 在途时切到词 B 再点
操作,B 的 PUT 起跑后 A settle,finally 把 B 仍在途的 `saving` 清掉——状态
按钮在 B 的 PUT 落地前重新可点(重复提交窗;PUT 幂等,后果轻但标记为错)。
CODING_STANDARDS「Per-entity async UI state keys by entity」的判据
(can two of these run at once?)在此答案为 yes:两个词的 PUT 可同时在途。

## 待决

`saving` 按词键控(Set/Map),还是弹窗单词视野下单槽 + 换词/settle 时序收口
即够;若按实体键控,与「弹窗同时只显示一个词」的视野语义怎么合,triage 定。
