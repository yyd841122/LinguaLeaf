# annotated-blocks-kernel(逐词渲染内核两宿收编)— 设计评审稿 v2

状态:grilling R1 八题 + Codex 评审吸收完毕,**待维护者拍板**;拍板后升格
spec-as-ticket(spec.md,循 status-join 形)。
来源:architecture-review-20261102 候选 2(Strong;报告 gitignore 不入库,
事实以本稿现场取数为准)。
取数基线:HEAD d26e6f5,2026-11-03。评审记录:Codex review-plan
(gpt-6.1-sol/high read-only)threadId `01a19f8f-0a34-7640-95df-db4e46164768`,
job `review-plan-mw05r8mr-gxbnpv`,裁决 NEEDS REVISION(11 发现,升格时随
本节移入票面 Comments);评审方独立跑通 `npm --ignore-scripts run typecheck`
与 `npm run lint`。评审承重事实(标记 §R)已由编排侧现场复核成立。

## 0. 问题

逐词 span、句子块、点击/键盘委托在两宿近逐字镜像。函数体口径:web 157 行
(55+35+43+24)/ ext 116 行(50+45+21),合计 273(报告 ~236 为不含 web
SentenceBlockView 的旧口径,且 ext BlockView 已漂 43→45)。与
word-lookup-kernel(05a204d)收编的弹窗镜像同类、只差一层。唯一已知语义
分歧:settled 来源(web 位置序 `wordStatuses[index]` 服务端 join vs ext 词元
查表 `stateOf(word)`)。

## 1. 现场盘存(2026-11-03,HEAD d26e6f5)

| 块 | web ReadingView.tsx | ext ReaderPage.tsx | 体差 |
|----|--------------------|--------------------|------|
| WordSegments | :26-80(55 行) | :103-152(50 行;注释 :96 起) | 第三 prop + settled 两行 + 注释两处,其余逐字同 |
| SentenceBlockView / 句子分支 | :87-121(35 行) | 折在 BlockView 句子分支 | web 有 ipa-line fallback + 译文行;ext 无 |
| BlockView 三分支 | :123-165(43 行) | :154-198(45 行) | web 全分支写 data-position;ext 无 |
| 点击 + 键盘委托 | :190-213(24 行) | :463-483(21 行) | web 的 onWordClick 可选守卫;余逐字同构 |

- 报告行号漂移:settle-channel 02 上移 ReaderPage +4 行。
- 两宿渲染件均模块私有;web 侧消费方仅 ReadingPage.tsx:26/410。
- **范围排除(§R 评审补)**:ext PDF overlay 点击委托(ReaderPage.tsx:749
  onOverlayClick、:788 onClick;pdf.ts:218-219 词节点带 role="button" +
  tabindex="0")只有点击没有键盘处理——本票只迁章节委托,PDF 保持现状;
  键盘缺口已立 stub 票 `.scratch/pdf-word-keyboard/`(needs-triage)。

## 2. 报告外新发现(第二语义分歧)

`word-settled` 的 affordance-withdraw CSS 只在 web style.css:243-245 存在;
共享表 annotated-shared.css 只有基础 hover 底色(:85-88,`@shared
lookup-word-hover` fragment),无 settled 变体。ext 自 b38b78b 起发出
`word-settled` 类(ReaderPage:125/139)但任何样式表都无对应规则——ext 的
known/ignored 词 hover 仍亮查词底色,ReaderPage:100-102 注释与 ADR-0005
声称的 withdraw 在 ext 不兑现。

共享表消费方三方:web style.css:3、ext reader.css:4、export——export 经
`npm run build:export-style --workspace @lingualeaf/server`
(apps/server/scripts/build-export-style.mjs)按 `@shared <name>` fragment
装配进 apps/server/src/export/style.generated.ts(generated 产物,header
明载再生命令;freshness gate 已有:apps/server/test/export-style-fresh.test.ts,
不必再造)。fragment 机制:共享表 25 个命名 fragment,export 侧按同名注释
定位 cascade 位置,**新增 fragment 必须在 annotated-style.css 有消费点,
否则生成器报错**——故 Q5(a) 推荐并入现有 lookup-word-hover fragment。
export 渲染(annotated-book.ts:72)只发 `ipa-word`/`lookup-word`,不发
settled 类——规则对 export 惰性(零行为变化),但再生仍必须。

## 3. 已由代码定案(不再决策)

1. **内核家 = reading-model/react 子入口**:现成(WordLookupPopup/useOwner/
   useSettle/wordFromEvent 已住;check:react-locality 门禁已在)。
2. **标注行三值语义**(§R 评审 #1 高,原「不可达」论证作废——paired 是
   运行时不变量非类型强制,且空标注行占位:annotation-lines fragment
   `min-height: 1.4em`,误生成空行会改 ext 布局):
   `undefined = 不提供该行 / null = 保留空行 / string = 内容`;渲染条件
   同时检查字段 `!== undefined`。web 现状逐位保持(ipaText null → 空行;
   showTranslation true + translationText null → 空行),ext 不传 → 永不生成。
3. **walk/slot 语义**(§R 评审答复 2):`ipaSlots = null` 与数量不匹配均为
   不配对;空字符串 slot = 该词无逐词音标;`position` 落在原根 DOM 节点、
   覆盖所有 kind(`!== undefined` 判,可为 0)。
4. **宿侧留置**:section 外壳与容器(web `.blocks` + aria-labelledby + 字号
   CSS vars;ext reader-chapter + data-block-index 包裹 div + 目录/分页/
   drag-drop)、列表映射、memo 边界留宿侧 ReadingView 不动。§R 评审答复 3:
   nodes 数组本就每 render 重建,adapter 不破坏外层 memo;禁缓存闭包
   (会捕旧状态);保持空 `.ipa-word-ipa[data-ipa]` + `::before`(IPA 改
   文本子节点会破坏原文选择与复制)。
5. **ADR 一致性**:ADR-0001(自建句子块视图)不受影响——收编是家搬家不是引
   引擎。ADR-0006 原文仍写「纯 TS 复用」(§R 评审 #9):react 子入口先例
   (05a204d)是扩大该条款的实施现状而非 ADR 文本已改——升格 spec 时在
   票面记一句复用范围澄清,ADR 文本是否补记另行决策,不在本票。
6. **既有测试零改写**:词单元钉 grep 下界 24 处(web reading.test 10 +
   wordLookup.test 5 + ext readerPage.test 6,另 domQueries.ts 3 处系 helper
   共享选择器非测试,§R 评审 #9;grep 只当下界,计数以跑套件输出为准)。
7. **重建纪律**:改 reading-model src 后 dist 必须重建(npm test 的 pretest
   已焊);沙箱侧验证以 typecheck + lint + 非 HTTP 测试为准,全量留编排侧。

## 4. 待拍问题(grilling R1 × Codex 评审后定形)

- **Q1 内核边界** — 同意 (a):全收 WordSegments + SentenceBlockView(折进
  内核句子分支)+ BlockView 三分支 + 点击/键盘 handler;WordSegments 为内核
  内部实现;PDF 范围明确排除(§1)。
- **Q2 settled 来源参数化** — 同意 (a) 并补契约(§R 评审 #5):
  `statusOf` 是**句块绑定读取子**,`index` 句内、从零、仅计 word segment;
  返回含缺界:`web (_w, i) => block.wordStatuses[i] ?? null`,ext 忽略
  index 传 `(w) => stateOf(w)`;内核每词读一次后折叠 known||ignored。
- **Q3 内核载荷形状** — (a) 改形为**完整 discriminated union**(§R 评审
  #7;exactOptionalPropertyTypes 已开,tsconfig.base.json:9,可选性区别
  直接影响编译):sentence 明含 `kind: "sentence"`,text 字段
  `?: string | null`(undefined/null 分轨见 §3-2),所有 kind 支持
  `position?: number`;web adapter 做 originalText→text 映射,ext 直传。
- **Q4 委托形态** — 同意 (a) 并补契约(§R 评审 #8):无回调**不挂
  handlers**(传 no-op 仍会 preventDefault,与 web 现状提前返回不同);键盘
  坐标锚保持 `event.target` 矩形,不改 `closest("[data-word]")`;钉 Enter/
  Space/他键/非词目标/preventDefault/非零矩形坐标。
- **Q5 withdraw CSS 上收** — 同意 (a) 并落地形态(§R 评审 #6/#11):规则
  **并入现有 `@shared lookup-word-hover` fragment**(不建新 fragment),
  web 本地副本(style.css:243-245)删除,generated 按 header 命令再生
  (freshness gate 复用);文件级钉联合检查:两 selector + 声明、两宿
  @import、DOM class 发出、web 副本删除、generated 新鲜度;明说 jsdom
  对真实 hover/复制行为盲,浏览器抽验不作本票 gate、记票面。
- **Q6 测试策略** — (a) 改形(§R 评审 #4):先钉后迁 + **共享行为套件 +
  宿侧差异断言 + CSS 接线检查**;验收矩阵:多句夹 plain 块、跨句索引复位、
  同词不同位状态、null/错长/空 slot、position=0 与缺省、状态切换重渲、
  无回调、标注行缺省 vs 空值;共享主张双宿各传 adapter 各跑
  (循 wordLookupRaceSuite/settleRaceSuite 先例)。
- **Q7 票目与 gate** — (a) 改形(§R 评审 #10):spec-as-ticket 单票、
  **三个 commit**:①刻画现状(证词钉,绿于现行手抄 JSX)②纯迁移(宿换
  内核引用,既有断言零动)③CSS 修正 + web 副本删除 + export 再生 + 新增
  声明钉——CSS 修正不混进迁移 commit,保住「迁移零行为变化」证据链。
  gate = caller 显式补跑 `npm run verify` 全绿;评审基线写关系不写 SHA
  (「本票首个实现 commit 之前的 HEAD」)。
- **Q8 选道** — 同意 Lane B:Codex 沙箱实现(workspace-write)、双轴评审;
  全链 verify 留 caller。与 word-lookup-kernel/jump-target-protocol/
  status-join 同型;settle-channel 两票的 A 是维护者点名翻转,不构成默认。

## 5. 约束与边界

- 行为预算:commit ② 迁移两宿零行为变化;唯一行为变化在 commit ③ 的 ext
  withdraw(web 零变、export 惰性)。
- 服务器运行逻辑与 wire 不变;服务器侧唯一改动是 export CSS generated 产物
  再生(§R 评审 #2 口径修正)。
- 现场取数纪律:实现时仍须重读现场,禁转抄本稿(行号会漂)。
- 术语:GLOSSARY 如有新词条(如「词单元」)随票落盘。

## 6. 验收草案(粗,升格 spec 时细化)

1. 内核(WordSegments/句子块三分支/委托工厂)+ 双宿 thin adapter;两宿既有
   测试断言零动全绿。
2. 共享套件工厂住 reading-model/testing:§4-Q6 验收矩阵一遍书写,双宿各跑;
   键盘委托从零钉变有钉。
3. withdraw 规则入共享表 fragment + generated 再生 + 文件级联合钉;
   web 本地副本删除;ext 行为变化记票面 Comments。
4. `npm run verify` 全绿(caller);评审基线 = 本票首个实现 commit 之前的
   HEAD。

## 7. 评审吸收账(NEEDS REVISION 11 发现 → 处置)

| # | 严重度 | 要点 | 处置 |
|---|--------|------|------|
| 1 | 高 | 标注行 undefined/null 语义,空行占位 1.4em | §3-2 重写,Q3 随 |
| 2 | 低 | 「服务器零涉」与再生冲突 | §5 口径修正 |
| 3 | 中 | PDF 点击委托漏列、无键盘 | §1 范围排除 + stub 票已立 |
| 4 | 中 | 验收矩阵不足 | Q6 改形 |
| 5 | 中 | statusOf 作用域/缺界 | Q2 补契约 |
| 6 | 中 | fragment 必须有消费点;脚本路径错 | Q5 并入现 fragment;路径修正 |
| 7 | 中 | 完整 union + exactOptionalPropertyTypes | Q3 改形 |
| 8 | 中 | 无回调 preventDefault 差异;坐标锚 | Q4 补契约 |
| 9 | 低 | ext 总量口径;domQueries 非 test;ADR-0006 文本 | §0/§3-5 修正 |
| 10 | 中 | CSS 修正混迁移削弱零变化证据 | Q7 三 commit |
| 11 | 中 | 文件级钉强度不足 | Q5 联合检查清单 |
