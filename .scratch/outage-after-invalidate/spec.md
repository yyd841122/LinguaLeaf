# outage-after-invalidate:被 invalidate() 作废的在途 tick 失败仍置 outage

Status: needs-triage

来源:owner-token 收编途中发现的既有问题(.scratch/owner-token/spec.md
Comments,2026-10-27);非该票引入,按决策 6 零搭车记档后另票。

## 问题

`apps/web/src/taskFollower.ts` 的 tick `.catch` 只看 effect 级 `cancelled`,
不看 `ticket.stale()`:一个已被 `invalidate()` 作废的在途 tick(其成功响应
本会被丢弃)若随后失败,仍会把 `outage` 置真,页面上出现一个属于已作废轮次
的断连提示。

## 待决

作废轮次的失败算不算服务端不可达:算(失败本身是健康信号,who 报告都行)则
现状为对,补一条测试钉住;不算(该轮已整体作废,不该再发言)则 catch 侧加
stale 判断。shelf 的 upload/delete 与翻译 trigger 两类 mutation 语义是否
有别,一并定。
