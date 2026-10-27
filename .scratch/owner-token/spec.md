# owner-token:「陈旧异步响应不得写状态」一处不变量一个 module

Status: done

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

- [x] 四点收编完成(或裁剪门触发点数记 Comments),四处既有测试零改写跑绿
- [x] module 单测套新增且可红验证;mark/stale/invalidate 三动词各有着落
- [x] 行为零变化:verify 全链绿(看退出码),每个实现 commit 门禁绿
- [x] GLOSSARY 词条落地;零触碰清单零违
- [x] 收尾票 Comments 记档(含行为/命名偏差、裁剪门结果)

## Comments

> grilling 会话 2026-10-27,两轮八决策与维护者对齐锁定:范围四点全收+裁剪门、
> progressSession 排除、useOwner 变长 key 三动词、不变量与生命周期分家、
> 零变化红线、GLOSSARY 词条无 ADR、载体门禁循 popup-status-backedge 先例。

**收官(2026-10-27,编排会话)**:实现 commit 630735f(cc-suite `/implement`,
gpt-6.1-sol / high / workspace-write,Codex thread
01a17c19-7930-7532-82e1-72c3a67272ab;沙箱禁网,门禁与提交由编排侧补)。
门禁:`npm run verify` 全链 EXIT=0,实现 commit pre-commit 全链绿。
零改名零挪动:interface 名字维持 `useOwner`/`mark`/`stale`/`invalidate`。

- **裁剪门结果(决策 2):三点收编,ReadingPage 触发裁剪门保留原实现**。
  chapterTranslation(删 `currentRouteRef` + 局部 `stale()`)、
  WordLookupPopup(删 `currentWordRef` + 局部 `stale()`,出参仍无条件先行)、
  taskFollower(删 `versionRef` 手滚 `invalidate`,effect `cancelled`+
  `clearInterval` 依决策 5 原样保留,对外 `TaskFollower` interface 不变)
  三点通过。ReadingPage 未通过:原 cleanup 的取消是**一次性的**——A→B→A
  再入导航后,键比较会让首程 A 的旧票重新有效(stale() 对当前键判,键转回
  A 即不陈旧),而原 `cancelled` 旗永久作废该程响应;两侧响应交错且服务端
  数据在两程之间变化时,终态可异。决策 5「route 键控 token 覆盖后 cleanup
  为空」的前提在该再入场景不成立。曾评估「cleanup 里调 `owner.invalidate()`」
  变体:行为等价但保留生命周期又叠加 token 机制,不比原来简,同样不收。
  按决策 2 该点不收编,原文件零 diff;四处既有测试(含加载竞态)零改写跑绿。
- **Spec 轴一条非阻塞观察(不阻塞,不改)**:弹窗守卫基从 found 态的
  `state.lookup.word` 变为 `word` prop。在「prop 已换词而 [word] effect 尚未
  重置 state」的微窗内点按,新守卫对旧词 PUT 的裁决与旧守卫一瞬不同;但该
  patch 或被随后的重置 `setState(loading)` 抹去(effect 已在途中),或因
  `phase!=='found'` 被 updater no-op——任何路径都到不了渲染输出,属不可观测
  窗口。稳态语义逐行核对等价;既有弹窗测试零改写跑绿即守门。若日后要消除
  该语义差,取「owner 键改用 `state.lookup.word`」另票,不搭车。
- **Standards 轴零硬违规,三条 judgement call 记档**:①`stale()` 的键长
  守卫似 Speculative Generality——变长 interface(决策 4 锁定)下键元数
  变化是公共契约可达形态(如条件展开 `...(route ? [b, c] : [b])`),属诚实
  语义非投机,测试按契约表述保留;②`...parts: unknown[]` 位置参数换位可静默
  反转陈旧性(Primitive Obsession)——决策 4 锁定变长 key 形状,记档不改;
  ③taskFollower 内 `cancelled || ticket.stale()` 双机制并存——决策 5 明文
  (不变量与生命周期分家),有意保留。
- **另票候选(重构途中发现的既有问题,零搭车,决策 6)**:①taskFollower 被
  `invalidate()` 作废的在途 tick 若失败仍会置 `outage`(该轮已作废,失败却
  计入);②弹窗旧词 PUT 的 `.finally` 会在新词 PUT 在途时清掉 `saving`
  (单槽在途标记跨词串扰)。均为收编前既有行为,本票未触碰,候选另立票。
- **红验证**:module 契约测试 11 条,隐藏 `useOwner.ts` 后跑 RED_EXIT=1
  (import 失败全红),还原后 11/11 绿;四处既有测试文件 git diff 为空
  (零改写之机械证明)。
- **双轴 review**:基线 = 本票首个实现 commit 630735f 之前的 HEAD
  (0fe9d1e,钉关系)。Standards 零硬违规(三条 judgement call 见上);
  Spec 判定:缺失零、越界零,ReadingPage 回退与原文件逐位一致、裁剪门推理
  成立,决策 1–8 与零触碰清单逐条对上;引文逐字核对无出入。
