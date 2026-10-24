# task-lifecycle module:后台任务生命周期收进一个 deep module(架构评审候选 2)

Status: done
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

## Comments

### Grilling 决策(2026-10-24,五项全数与维护者对齐锁定)

1. **落点**:新建 `apps/server/src/task-lifecycle.ts`,`task-tracker.ts` 折入删除
   (全仓仅两个任务文件引用)。模块领域无涉(不 import pipeline/dictionary/
   translator);两个任务文件留原地瘦身为「组装 spec 并 fire」,领域正文不搬,
   `runImportTask`/`runChapterTranslationTask` 签名不变——router 与 api.test 零感知。
2. **fire 形状**:`fireTask({ label, writeProgress?, settleFailed, run })` 通用信封;
   99 天花板按「吸收」严格义走 report 注入(writeProgress 进 spec,模块钳 99 后交
   run),「翻译中永不说 100」与 never-throw 同族住进信封。label 复现原日志文案
   (`Import of book N` / `Translation of chapter N`),逐字节零行为变化。
3. **sweep 形状**:模块导出 `sweepInterruptedTasks(database)`,配对调用 book-store
   双 sweep(SQL 与守卫留 store),并持有两条 console.warn 文案(与 main.ts 原文案
   逐字节一致);store 静默契约由模块作为调用方承接。
4. **drain 归一 + 门禁解释**:tracker 归一,main.ts 单挂 `drainTasks(3000)`;
   per-kind drain 删除。门禁「既有契约断言零删除零改写」解释为保护断言内容,不保护
   import 行与调用手法——三个测试文件(import-task.test / chapter-task.test /
   contract.test)换符号,expect 逐字节保留(git diff 复核:仅 import、调用符号、
   一个 `it` 标题随符号更名)。
5. **测试种植口**:种植口 = fireTask 收 body 闭包这一缝,测试直接向真 tracker 种
   可控在飞任务。新增 `apps/server/test/task-lifecycle.test.ts` 八例:drain 挂住/
   release 解算、grace 到期即解算、run 拒绝走 settleFailed 且 promise resolve、
   同步 throw 同权、settleFailed 再抛被吞+记日志、干净 body 不触 verdict、report
   99 钳制、无 writeProgress 时 report 为 no-op。

### 收尾(2026-10-24)

- `npm run verify` 退出码 0(typecheck、296 tests 含新 8 例、lint --max-warnings 0、
  check:sql-locality、build 全过)。
- 附带事实修正:`translateChapters` 死泛化删除(唯一调用方永远传一章;batch.test
  只测 `translateSentences`,零测试随删);batch.ts 与 book-store.ts 里引用已死
  先例(import 报百分比、translateChapters)的注释改为指向现存事实。
- ADR-0004 第 21 行的 translateChapters 是历史决策记录,未动。
- 无遗留人工步骤。

### review 处置(2026-10-24 code-review,commit be5a1aa,双轴 841cbbf 基线)

- Standards 轴无硬违规。S1(判断项):`sweepInterruptedTasks` 内两条 count-and-warn
  形状平行——处置:保持现状;警告是散文形状的两条文案,折成 {count, noun,
  destination} 循环反而绕。S2(判断项):`writeProgress?` 可选参数疑似 speculative
  generality——处置:suppressed,章进度先于本票存在、注释已写明 import 无此项、
  no-op 路径有测试钉住,属 real-need。
- Spec 轴零发现:五项决策逐条核符,断言零改写经 diff 机械核验(diff 中零条含
  expect 的删除行),verify 退出码 0。
- 无需代码改动。
- 翻案(2026-10-24 retro,维护者裁定「全部修复」):S1 已折叠——`sweepInterruptedTasks`
  表驱动(sweep + warn 文案一行一种,文案逐字节不变);retro 候选 1 一并落地:
  `apps/server/scripts/check-task-lifecycle-locality.mjs` 接入根 `verify` 链与
  pre-commit,tracker 指纹(`new Set<Promise` / `createTaskTracker`)出现在
  task-lifecycle.ts 之外即 fail(负测试验证咬合)。S2 维持 suppressed:去掉
  `writeProgress?` 会倒退 grilling 决策 2,无「修」的形状。
