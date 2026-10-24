# task-lifecycle module:后台任务生命周期收进一个 deep module(架构评审候选 2)

Status: ready-for-agent
Type: task

来源:2026-10-24 architecture review(.scratch/architecture-review-20261024-092119.html
候选 2,Strong)。

## 问题

import-task.ts 与 chapter-task.ts 是同一「后台任务 lifecycle」的两份手抄:never-throw
信封、catch 里再守一次 settle、99% 诚实天花板、twin SET 常量与中断文案
(book-store.ts 两半)、twin sweep、main.ts 双挂 drain。契约只活在注释里,而注释引用的
先例(import 报百分比)已随 ADR-0004 ticket 02 消失;batch.ts 的 translateChapters
多章切片是死泛化(唯一调用方永远传一章)。audit 2026-10-23 的 shutdown/settle 规则
改动被手工改了两遍。

## 方案(报告候选 2 卡,方向非合同)

一个任务 lifecycle module:interface 是 fire / drain / sweep,外加给测试种植状态用的口;
implementation 吸收 never-throw、guarded settle、99 天花板;SQL 守卫留在 book-store;
章形入口折进 module;batch.ts 死泛化收敛。

## 参照

- 网页端孪生已按同法落地并过双轴 review:.scratch/task-follower/spec.md(7 决策 +
  review 处置)与 apps/web/src/taskFollower.ts——interface 收窄的形状照它的样子。
- 动工前先跑一轮 grilling:模块落点、fire/sweep 的 interface 形状、测试种植口——
  这些决策未经过对齐,报告卡只给方向。

## 门禁

既有契约断言零删除零改写,新增只追加;`npm run verify` 全绿(看退出码,不看 tail)。
