# settle-channel 02:难站四枚(#4 外携票据 / #5 不凭票落页 / #6 点击作废 / #7 cleanup 作废 + merge-wins)+ CODING_STANDARDS 回指

Status: done

来源:`../spec.md`(D1-D5/Q6-Q11 全拍,2026-11-02)+ 01 票
(`01-channel-and-simple-sites.md`,Status: done)落地现实:useSettle 九语义
已定死并实现(`packages/reading-model/src/react/useSettle.ts`),settleRaceSuite
四主张已带 `applied()` 观察落盘(`packages/reading-model/src/testing/index.ts`)。
基线:HEAD before this ticket's first implementation commit。
开放决策四枚维护者已拍(2026-11-03,见 Comments 决策记档)。

## 范围(02)

- 迁移四站:#4 progressSession.flushSave(外携票据)、#5 WordLookupPopup
  .applyStatus(onLanded/onFresh)、#6 ext ReaderPage.reopenDocument(reopenSeq
  → 令牌)、#7 ext ReaderPage 词状态 bulk read(cancelled → teardown
  invalidate + merge-wins)。
- settleRaceSuite 扩展:applies 声明 + 站点级 landed 场景(#5 双宿)。
- CODING_STANDARDS.md 两裁决条目回指通道(条目见下)。
- **不在本票**:内核九语义与既有 10 枚内核测试零改动;ext 的
  `reader/WordLookupPopup.tsx` 薄壳适配层(传 store 当 gateway)零涉;
  spec.md 不回改(评审稿历史载体,翻转只记票面);#6 失败可见面(静默,
见 Comments 决策 3)。

## 接口现状(01 已落地,02 只消费不再改)

`useSettle(owner)` ⇒ `{ failed, clear, run }`;run 照发、禁隐式 invalidate、
成功序列 landed→verdict→(新鲜才)清旗+fresh、失败新鲜才起旗、拒绝永不穿透
(凭 `SettleOutcome.ok` 分支)、票据三态(省略=op 起点 mark / 传票=凭它 /
显式 null=照发全不写)、钩子缺省各自 no-op 互不回退、hook 同步抛出按调用方
缺陷 reject 且裁决写入不回滚、run/clear 引用稳定。完整签名与语义编号见
01 票「接口定稿」节与 `useSettle.ts` 注释。

## 四站行为矩阵(冻结)

| 站 | owner | 旗 | 作废点(显式) | run 用法 | 行为等价锚(既有用例) |
|---|---|---|---|---|---|
| #4 flushSave | `useOwner(bookId, chapterNumber)`(progressSession.ts:82,现状既有) | saveFailed → channel.failed,公开 surface `{ saveFailed, armJumpTarget }` 形状不变 | arm 头 `owner.invalidate()` + ref 铸票(progressSession.ts:241-242,**现状既有,保留**;ref 而非 render 常量的注释 :115-122 原样保留) | `run(saveReadingProgress(bookId, pending), { ticket: saveFeedbackTicketRef.current })` —— **零钩子**(成功只清旗 = 通道新鲜成功清旗本身);仍 `if (pending)` 后才 run | progressSession.test **33** 枚 verbatim 绿(2026-11-03 实跑),含三枚 lit-state 竞态钉:旧路由迟到失败不置新旗(:322)、陈旧成功不清已亮旗(:347)、离开重回不复活首过票(:376) |
| #5 applyStatus | `useOwner(word)`(WordLookupPopup.tsx:85,现状既有) | saveFailed → channel.failed | applyStatus arm 的 `setSaveFailed(false)`(:116)→ `channel.clear()`;查词 effect 的 word 变更清旗(:91)→ `channel.clear()`。**逐 op mark 省略票**(现状 :123 mark 铸于 op 起点,等价) | `run(gateway.setStatus(key, status), { onLanded: () => onStatusApplied(applied), onFresh: () => setState(补丁) })`(T=void,闭包忽略入参);现 :127-138 的 landed→stale→补丁次序由内核序列原样接管 | web wordLookup.test **27** 枚 + ext readerPage 内 popup 组 **19** 枚文件 verbatim 绿;landed-when-stale(移词后 applied 照报)已由 wordLookupRaceSuite 双宿钉住 |
| #6 reopenDocument | **新** 私有 `useOwner()`(per ReaderPage mount,无键——点击侧 invalidate 已覆盖 A→A,键比较反会复活) | channel.failed 存在但**无 UI 面**(决策:静默,失败面不加,见 Comments 决策 3) | **每次点击开头 `owner.invalidate()`**(seq→invalidate 恰等价:seq 比较判旧即弃,invalidate 永久杀全部前票,A→A 同杀) | `run(library.openDocument(entry.id), { onFresh: (book) => { if (!book) return; …原 :330-337 应用 } })` —— `!book` 是数据缺无不是陈旧,留 onFresh 内守 | readerPage.test **19** 枚 verbatim 绿;reopen 成功钉(:604)/跨书进度独立(:625)是应用路径锚;**竞态(慢 A 不覆盖已选 B)现状无钉——本票补**(见测试节) |
| #7 bulk read | **新** 私有 `useOwner()`(循 taskFollower Q7 先例;per-mount 无键,teardown invalidate 已覆盖章节切换) | channel.failed 存在但**无 UI 面**(失败静默是现状,best-effort 读不加提示) | effect cleanup `owner.invalidate()` 替换 `cancelled = true`(:363;= taskFollower teardown 等价迁移) | `run(resolvedStore.statesFor([...keys]), { onFresh: (found) => setWordStates(merge-wins) })`;merge-wins(:368-374,已有键胜)**原样留 onFresh 内**——它与裁决正交;失败静默 = 拒绝吞进 outcome 不 rethrow | readerPage.test verbatim 绿;录制态钉(:401)/即时生效钉(:426)是应用路径锚;**「bulk 迟到不回退 popup patch」现状无钉——本票补** |

清旗全清单(02 范围,全部显式 `channel.clear()`):#5 的 applyStatus arm
(现 :116)与 word 变更 effect(现 :91)两处。#4 **零 clear**(现状从不在
开始清旗,唯一旗写就是通道的新鲜成败两处);#6/#7 无旗面故无 clear。
#4 建 flush、#5 各 op、#6 各点击、#7 各读均不在开始清旗。

## 逐站要点

- **#4**:外携票据直通——ref 可 null(类型现状 `OwnerTicket | null`),
  null = run 的显式 null 分支(照发全不写)。现场核实:null 态经站点公开面
  **不可达**(三个 scheduleSave 调用点全部位于 arm 铸票之后,timer 500ms
  晚于同一 commit 的 effect 序),是防御分支——站点级 null 场景**不建**
  (不可达状态的钉是假钉),内核 10 枚已含已起旗态 null 全不写钉,
  站点级「发送不受裁决」由 :322 现行钉承责;01 票面「02 的 flushSave 启用
  站点级 null」按此发现重划,记 Comments。
- **#5**:savingKeys 在途键控 + finally 释放(:84,:115,:145-151)**留在
  通道外**——通道裁裁决,不裁在途标记(CODING_STANDARDS「Per-entity async
  UI state keys by entity」是该边界的现行文档,不回改);新鲜成功清旗在
  现状是 arm 侧清(:116)后旗恒暗,通道加的新鲜成功清旗不可见,byte 级等价。
- **#6**:失败路径现状 = `void reopenDocument(entry)`(:649)的 async 函数
  无 catch → **unhandled rejection**,UI 无表现(停 empty 可重试)。通道化
  后拒绝吞进 outcome,可见行为不变,控制台噪音消失——保持静默并补
  characterization 钉(见测试节)。`setWordStates(new Map())` / restoreRef /
  setState 三件应用(:330-337)整体进 onFresh。
- **#7**:effect 头三个守卫(:351-353)原样;键收集(:354-362)原样;
  只动 cancelled→invalidate 与 .then/.catch→run。StrictMode 双挂载等价性
  由 taskFollower teardown 三枚先例同形覆盖(本票新钉见测试节)。

## settleRaceSuite 扩展(testing/index.ts,增量)

1. **applies 声明**:套件描述子加可选字段(命名归实现,如
   `applies: false`),声明本站新鲜成功无可见应用面。主张 2「清旗并应用」
   /主张 3「陈旧成功旗与应用全不动」的 applied 断言按声明裁剪;**旗断言
   全保留**——双臂先行(败先亮旗、成后必清)与 lit-state 结构照旧,
   #4 即首个 applies:false 宿。
2. **站点级 landed 场景(新主张,宿为声明 onLanded 的站,#5 双宿)**:
   先令旗亮(A 词存盘失败),再落陈旧成功(B 词已起 op、站点已移走):
   landed 应用照发(applied 收到)、旗**保持亮**、本地无补丁。变异
   「landed 顺带清旗」在此红。
3. **#6/#7 不做套件宿**(决策 1):无旗面站点的 failed() 无处读,扩展
   harness 契约或测试专用暴露旗都违背对外不可见预算;通道裁决语义已由
   内核 10 枚 + 01 三站宿 + #4/#5 宿全覆盖,#6/#7 行为等价靠 verbatim 绿 +
   下方四枚新钉。

宿分布:01 三站(不动)+ #4(progressSession.test 新 mount,applies:
false)+ #5(web wordLookup.test 与 ext readerPage.test 各一 mount——
循 wordLookupRaceSuite 双宿先例,宿各传真 gateway 适配)。

## CODING_STANDARDS 回指(只回指,不立新条目)

- **「Retry loops escalate persistent failure」**(:65):补一段——失败旗
  的举起与清除是落回裁决通道(useSettle)的裁决写入,新异步站不加手抄
  旗;指向 `.scratch/settle-channel/spec.md`。
- **「Cleanup flags revoke once; key comparison can revive」**(:348):补
  一段——裁决机制的替换(seq 计数、cleanup cancelled → 属主令牌 + 通道)
  循本条走;#6/#7 的迁移即此条的应用现场;指向 settle-channel。
- 「No-change claims test against a lit state」(:397)已于 01 收官时引用
  settle-channel 01,02 不再改;评审对 02 的「钉住」声称按同条做变异心证。

## 测试(增量,既有用例零改写为预期;出现改写/删除逐条列名+理由入 Comments)

1. **verbatim 绿包络(行为等价直接证据)**:progressSession 33、web
   wordLookup 27、ext readerPage 19(计数取 2026-11-03 实跑输出,
   `it.each` 已展开);01 三站与内核、useOwner 各文件不动。
   wordLookupRaceSuite 双宿既有主张不动(#5 迁移后必须原样绿——它钉的
   正是 landed/savingKeys 边界)。
2. **套件扩展**(上节 1/2):#4 宿一 mount、#5 宿两 mount;新 landed 场景
   从 lit 旗出发(CODING_STANDARDS「No-change claims…」)。
3. **#6 新钉两枚**(ext readerPage.test):慢 A 后于已选 B 落地,A 不得
   覆盖 B(点击作废竞态,现状无钉);失败的 reopen 留在 empty 阶段、
   可重试、不抛 UI 面(characterization,钉静默)。
4. **#7 新钉两枚**(ext readerPage.test):bulk 迟到落地不回退已 patch 的
   词(merge-wins lit-state:先 patch 再放行 bulk);章节切换后旧读落地
   不写(teardown invalidate 等价,循 taskFollower 三枚同形)。
5. 变异心证归评审道(Codex):对「钉住」声称按 CODING_STANDARDS 同条
   做变异心证;重大变异发现记 Comments。

## 验收门

- 本地全链:typecheck + lint + 非 HTTP 测试全绿;上列三文件 verbatim 绿
  是行为等价的直接证据。
- react-locality 门禁:02 零新符号进 reading-model 根入口(useSettle 已在
  react/ 子入口,套件扩展只动 testing/);ext 侧 import 不新增依赖面。
- **caller 检查点(人工,勿跳)**:全链 `npm run verify` EXIT=0,收官在
  票面记 EXIT 与测试总数(计数逐字抄实跑输出,禁心算/禁 grep 源行)。
- **Lane A 管线(决策 4)**:Claude 实现(本地全链验证)→ Codex 审核
  (read-only,对照票面逐条 + 变异心证,threadId 入档)→ Claude 裁决:
  修笔当场改、记档 Comments → caller 显式补跑 `npm run verify`(退出码
  不等于 verify 门)→ 收官 docs commit 翻 Status: done。
- 基线记法照 tracker 规则:写关系不写 SHA。

## Comments

- (2026-11-03 立票)开放决策四枚,维护者拍板:① #6/#7 套件宿策略 =
  **行为钉路线**(不做套件宿,verbatim 绿 + 四枚新钉;扩展 harness 契约
  与测试专用暴露旗两案皆否——后者违背对外不可见预算);② #4 = **套件加
  applies 声明**(旗断言全保留,applied 断言按声明裁剪);③ #6 失败面 =
  **静默 + characterization 补钉**(不加可见提示,行为变更应另票);④
  实现道 = **Lane A**(循 01 翻转先例:Claude 实现、Codex 审核;spec Q9/Q11
  原文 Lane B 由本条覆盖,spec 不回改)。
- (2026-11-03 立票)现场发现即纠:01 票面「landed/null 场景 02 的
  popup/flushSave 启用站点级」之 null 半边,经站点公开面不可达
  (saveFeedbackTicketRef :123/:242 与三处 scheduleSave 的时序追明,null
  是防御分支)——站点级 null 场景不建,内核已起旗态 null 钉 + :322
  发送钉承责;landed 半边照建(上节场景 2,#5 双宿)。本条即 tracker
  「现场取数、漂移记档」纪律的 02 版。
- (2026-11-03 立票)常规裁量记档(未单独问拍):① #5 套件宿双宿
  (web+ext)循 wordLookupRaceSuite 先例,宿各传真 gateway;② CODING_
  STANDARDS 回指范围锁定两条(「Retry loops」「Cleanup flags revoke
  once」),「Per-entity」条不回改(savingKeys 留通道外的边界文档,
  现文已准确);③ 计数取证:progressSession 33 / wordLookup 27 /
  readerPage 19 取自 `npx vitest run` 三文件实跑输出(2026-11-03),
  非 grep 源行。
- (2026-11-03 收官)实现记档(Lane A 照拍板:编排会话直接实现,实现侧
  零 Codex threadId)。三 commit:① a1ddb79「先钉后迁」——套件三声明 +
  #4/#5 宿挂载 + ext 三枚竞态钉,生产零改动,新测试绿于现行手抄裁决
  (证词侧:迁移提交在此包络下换机制,包络未破即行为等价见证);②
  8a46dc8 四站迁移 + 静默钉 + CODING_STANDARDS 两处回指;③ 3f35529 评审
  修笔(下条)。迁移过程自抓两笔:弹窗 savingKeys 的 finally 退役初版
  遗漏(按钮会永久禁用)——改挂 run 的 outcome(内核吞拒不穿透,成败
  两路必达);#7 若把 channel 对象整体入 deps,旗变 identity 翻转会让
  失败触发 effect 重挂(行为漂移)——解构 runTintRead 稳定引用入 deps。
- (2026-11-03 收官)Codex 实现审核(gpt-6.1-sol/high read-only,threadId
  `01a19e90-153d-7a43-9c2c-803275dd6e9e`,job audit-mvzvt3pf-k7dul7):
  裁决 **NEEDS FIXES**,唯一发现 P2——静默 reopen 钉虚过:waitFor(no
  alert) 可先于拒绝微任务处理即绿,且 error phase 本就保留 picker 与
  recents,原断言不区分「留在 empty」与「进了 error 页」,变异「失败
  路由 error 页」全绿(CODING_STANDARDS「No-change claims…」的 vacuous
  pass 活例,01 的同款教训在站点级复发)。修笔全收:受控 Promise 门控
  拒绝、拒绝与落回在 act 内完成、判别断言改 .reader-error/alert/status
  三失败面全无、重试成功正控;突变注入后修笔钉恰好独红(1 failed 其余
  26 绿),还原全绿。评审其余全过:四站矩阵清旗逐格、三声明语义、双宿
  landed 真亮旗、包络 33/27/19 零改写、内核/01 三站/ext 薄壳零 diff;
  心证清单十变异各点名测试。记档两笔:① 必查项「run reject 漏 finally」
  前提不成立(finally 覆盖两路),评审自行否定;② 评审时点工作树含编排
  侧变异注入中的内核临时改动,评审正确排除、结论系于固定 commit 区间。
- (2026-11-03 收官)变异自证(编排侧实跑,评审心证清单子集):M2「陈旧
  成功也清旗」注入内核 → 10 红:settleRaceSuite 主张3 六宿全红(01 三站
  + #4 + #5 双宿)、02 新增 landed 场景双宿红、既有 lit-state 钉两枚
  (bookmarks 陈旧删、progressSession :347)同抓;M3「landed 凭新鲜才发」
  → 13 红:内核 3 枚(01 钉)+ wordLookupRaceSuite 双宿 + landed 场景
  双宿 + ext 页面钉。均还原全绿(内核零 diff 复核)。
- (2026-11-03 收官)收官证据:caller 检查点 `npm run verify` **EXIT=0**
  (48 files,**582 passed | 2 skipped (584)**,计数逐字抄实跑输出;01
  收官 566 → 本票 +16 passed +2 skipped,与四宿挂载主张/landed 场景
  +四枚 ext 新钉的账目相符)。typecheck/lint/vitest/locality 四门/build
  全链随 pre-commit 于 8a46dc8、3f35529 各复跑一轮全绿。
- (2026-11-03 收官)记档不修:onLanded/onFresh 同步抛出时 run 的
  promise reject 经 void 链成未处理拒绝噪声——内核语义 7 定死为调用方
  缺陷,评审同判(informational),静默钉与弹窗用例均不触及,留原样。
- (2026-11-03 收官)实践侧教训(入记忆账本,不入本票执行面):cc-suite
  守态 until-loop 里内联 node -e 的引号转义在 shell 单引号内必炸
  (SyntaxError → 判终态恒假 → 循环空转数小时,job 本体 07:22 即
  completed)——终态判断脚本落临时文件再调,勿内联带引号 JS。
