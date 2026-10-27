# owner-token:「陈旧异步响应不得写状态」一处不变量一个 module

Status: ready-for-agent

来源:2026-10-25 架构评审候选 5(`.scratch/architecture-review-20261025-164316.html`)。
前置:候选 2(reading-page-state-machines)已落地——评审「若做候选 2 本条顺路」
的条件已就位;popup-status-backedge(候选 4)spec 决策 5 明写本票接棒,其
currentWordRef/stale() 留待收编。grilling 两轮八决策与维护者对齐锁定
(2026-10-27)。单票体量,本 spec 即票。

## 问题

「陈旧异步响应不得写状态」是一条不变量,却在四个调用点以三种机制各写一遍:

- `apps/web/src/ReadingPage.tsx:61-78` 加载 effect:cleanup `cancelled` 旗,
  守 TOC+章节 fetch 的响应。
- `apps/web/src/chapterTranslation.ts:51-52,64-88` 翻译 trigger:
  `currentRouteRef` 比较 + 局部 `stale()`,守 202 补丁和 startFailed 认账。
- `apps/web/src/WordLookupPopup.tsx:69-70,107` 弹窗 PUT:`currentWordRef` 比较 +
  局部 `stale()`,守 pressed 补丁和 saveFailed(出参 `onStatusApplied` **有意**
  不守——「事实属于词,不属于弹窗当前视野」,popup-status-backedge 决策 3)。
- `apps/web/src/taskFollower.ts:33-36,52-58`:`versionRef` + `invalidate()`
  守轮询 tick,另有一份 effect `cancelled` 守 teardown。

此类 bug 已修过三轮(2026-10-23 audit 起),每处各配一份测试。规则在挣饭吃
却没有 module:每个新事件驱动异步点都要重新发明守卫(deletion test 下它在
N=4 处回来)。

## 决策(锁定)

1. **范围 = 四点全收,一张票**:三处手写守卫换成共享 module;taskFollower
   内部 `versionRef` 也改为消费 module(对外 interface 不变)。
2. **裁剪门(评审 ⚠ 落地)**:浅 module 风险的解法是逐点必须更简——任一调用
   点换用 module 后写法不比原来简,该点不收编、记票 Comments。四点是目标,
   不是硬指标。
3. **排除 progressSession**:其 `loadedProgress`(带 bookId/chapterNumber 的
   state 读侧比对)是「派生状态按路由键控」,另一条不变量、另一票;混入会撑大
   interface。
4. **Interface = `useOwner(...parts: unknown[])` 三动词 hook**:owner 身份 =
   key,变长参数逐项 `Object.is` 比对,渲染期取最新(现 `currentWordRef`/
   `currentRouteRef` 惯用法);`mark()` 起异步时取 ticket,ticket 上 `stale()`
   裁决(key 已前进或 `invalidate()` 后即陈旧),`invalidate()` 显式作废
   (mutation 语义,taskFollower 现形)。实现时发现更诚实的形状/名字可改,
   改动记票 Comments。
5. **归一的是不变量,不是生命周期**:加载 effect 的 `cancelled` 整个删除
   (route 键控 token 覆盖后 cleanup 为空;React 18 卸载后 setState 本就无害);
   taskFollower 的 effect `cancelled`+`clearInterval` 保留(interval teardown
   是生命周期卫生,不是本不变量);弹窗/trigger 的 ref+局部 `stale()` 全删。
6. **零变化红线**:行为零变化;四处既有测试零改写跑绿(弹窗 stale/出参分离、
   trigger 409 竞态、taskFollower invalidate、加载竞态全语义不动);module
   自带一份单测套;重构中发现真 bug → 记票 Comments 另票修,不搭车。
7. **词汇**:GLOSSARY 加「属主令牌 (Owner Token)」词条(格式循现有词条,含
   _Avoid_ 行);无 ADR,spec 即档。
8. **载体与门禁**:cc-suite `/implement` 实施(gpt-6.1-sol / high /
   workspace-write,Codex 不 commit)+ 编排侧 verify 门禁(看退出码)+
   双轴 review(基线 = 本票首个实现 commit 之前的 HEAD,钉关系不钉 SHA);
   新增 module 测试可红验证;收尾票 Comments 记档。

## 零触碰

- 弹窗出参触发语义(popup-status-backedge 决策 3:出参在 stale 守卫之外)——
  收编后仍不得吞出参,弹窗既有测试零改写即此意的守门。
- server 全部、wire.ts、reading-model;progressSession(决策 3)。

## 验收

- [ ] 四点收编完成(或裁剪门触发点数记 Comments),四处既有测试零改写跑绿
- [ ] module 单测套新增且可红验证;mark/stale/invalidate 三动词各有着落
- [ ] 行为零变化:verify 全链绿(看退出码),每个实现 commit 门禁绿
- [ ] GLOSSARY 词条落地;零触碰清单零违
- [ ] 收尾票 Comments 记档(含行为/命名偏差、裁剪门结果)

## Comments

> grilling 会话 2026-10-27,两轮八决策与维护者对齐锁定:范围四点全收+裁剪门、
> progressSession 排除、useOwner 变长 key 三动词、不变量与生命周期分家、
> 零变化红线、GLOSSARY 词条无 ADR、载体门禁循 popup-status-backedge 先例。
