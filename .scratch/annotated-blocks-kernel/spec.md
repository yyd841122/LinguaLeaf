# annotated-blocks-kernel:逐词渲染内核两宿收编

Status: ready-for-agent

来源:architecture-review-20261102 候选 2(Strong;报告 gitignore)。决策八锁
(2026-11-03,维护者「全按推荐」,含 Codex review-plan 评审吸收;评审稿
`.scratch/annotated-blocks-kernel/plan.md` 留档,评审 threadId
`01a19f8f-0a34-7640-95df-db4e46164768` / job `review-plan-mw05r8mr-gxbnpv`,
NEEDS REVISION 11 发现吸收账见 plan.md §7)。选道 **Lane B**(Codex 沙箱
实现,双轴评审)。评审发现的 PDF 键盘缺口另立
`.scratch/pdf-word-keyboard/spec.md`(needs-triage),不在本票。

## 问题(现场取数,2026-11-03,HEAD d26e6f5)

逐词 span、句子块、点击/键盘委托在两宿近逐字镜像,函数体口径 web 157 行
(WordSegments 55 + SentenceBlockView 35 + BlockView 43 + 委托 24)/ ext
116 行(50 + 45 + 21),合计 273。与 word-lookup-kernel(05a204d)收编的
弹窗镜像同类、只差一层。唯一已知语义分歧:settled 来源——web 位置序
`wordStatuses[index]`(服务端 join,apps/web/src/ReadingView.tsx:47-48)vs
ext 词元查表 `stateOf(word)`(apps/extension/src/reader/ReaderPage.tsx:
120-121)。第二语义分歧(报告外新发现):`word-settled` affordance-withdraw
CSS 只在 web style.css:243-245 存在;ext 自 b38b78b 发出该类
(ReaderPage.tsx:125/139)但任何样式表都无规则——ext known/ignored 词
hover 仍亮查词底色,ReaderPage.tsx:100-102 注释与 ADR-0005 声称的
withdraw 在 ext 不兑现。

镜像面:web ReadingView.tsx(WordSegments :26-80、SentenceBlockView :87-121、
BlockView :123-165、点击+键盘委托 :190-213);ext ReaderPage.tsx
(WordSegments :103-152、BlockView :154-198、委托 :463-483)。两宿渲染件
模块私有;web 消费方仅 ReadingPage.tsx:26/410。**范围排除**:ext PDF
overlay 点击委托(ReaderPage.tsx:749/:788;pdf.ts:218-219 词节点带
role/tabindex 无键盘)不迁,只动章节委托。

## 已由代码定案(契约,不再决策)

1. **内核家 = reading-model/react 子入口**(WordLookupPopup/useOwner/
   useSettle/wordFromEvent 已住;check:react-locality 门禁已在)。
2. **标注行三值语义**:`undefined = 不提供该行 / null = 保留空行 /
   string = 内容`;渲染条件同时检查字段 `!== undefined`(paired 是运行时
   不变量非类型强制;annotation-lines fragment `min-height: 1.4em`——
   误生成空行会改 ext 布局,web 现状 ipaText null → 空行逐位保持)。
3. **walk/slot 语义**:`ipaSlots = null` 与数量不匹配均为不配对;空字符串
   slot = 该词无逐词音标;`position` 落在原根 DOM 节点、覆盖所有 kind
   (`!== undefined` 判,可为 0)。
4. **宿侧留置**:section 外壳与容器(web `.blocks` + aria-labelledby + 字号
   CSS vars;ext reader-chapter + data-block-index 包裹 div + 目录/分页/
   drag-drop)、列表映射、memo 边界留宿侧 ReadingView 不动;nodes 数组本就
   每 render 重建,adapter 不破坏外层 memo;禁缓存闭包(捕旧状态);保持空
   `.ipa-word-ipa[data-ipa]` + `::before`(IPA 改文本子节点会破坏原文选择
   与复制)。
5. **类型已统一**:ext `VocabState = WordStatus` 别名
   (vocabulary-store.ts:7),settled 接口无需新类型桥。
6. **ADR**:ADR-0001(自建句子块视图)不受影响——家搬家不是引引擎。
   ADR-0006 原文仍写「纯 TS 复用」:react 子入口先例(05a204d)是扩大该
   条款的实施现状而非 ADR 文本已改(复用范围澄清记本票 Comments,ADR 文本
   是否补记另行决策)。
7. **重建纪律**:改 reading-model src 后 dist 必须重建(npm test 的 pretest
   已焊);沙箱侧验证以 typecheck + lint + 非 HTTP 测试为准,全量留编排侧。

## 决策(八锁,2026-11-03「全按推荐」)

1. **Q1 边界 = 全收**:WordSegments + SentenceBlockView(折进内核句子分支)
   + BlockView 三分支 + 点击/键盘 handler;宿侧只留 §契约 4 所列。
2. **Q2 settled 来源 = 状态读取子闭包** `statusOf(word, index) =>
   WordStatus | null`:句块绑定,`index` 句内、从零、仅计 word segment;
   known||ignored 折叠收内核单份,内核每词读一次。web adapter
   `(_w, i) => block.wordStatuses[i] ?? null`;ext 忽略 index 传
   `(w) => stateOf(w)`。
3. **Q3 载荷 = 完整 discriminated union**(exactOptionalPropertyTypes 已开,
   tsconfig.base.json:9):sentence 明含 `kind: "sentence"`、`text`、
   `ipaSlots: string[] | null`、`ipaText?: string | null`、
   `translationText?: string | null`;plain `{kind: "code" | "raw" |
   "image", text}`;所有 kind 支持 `position?: number`。web adapter 做一次
   originalText→text 映射,ext 载荷结构贴合直传。
4. **Q4 委托 = 纯 handler 工厂**:返回 `{onClick, onKeyDown}`,宿挂自己的
   section;**无回调不挂 handlers**(传 no-op 仍会 preventDefault,与 web
   现状提前返回不同);键盘坐标锚保持 `event.target` 矩形,不改
   `closest("[data-word]")`。
5. **Q5 withdraw CSS 上收**:`.lookup-word.word-settled:hover /
   .ipa-word.word-settled:hover { background: none }` 并入现有
   `@shared lookup-word-hover` fragment(annotated-shared.css:85-88;
   **不建新 fragment**——export 生成器要求每个 fragment 有消费点);
   web 本地副本(style.css:243-245)删除;generated 按 header 命令再生
   (`npm run build:export-style --workspace @lingualeaf/server`;
   freshness gate apps/server/test/export-style-fresh.test.ts 复用)。
   jsdom 对真实 hover/复制行为盲,浏览器抽验不作本票 gate、记 Comments。
6. **Q6 测试 = 先钉后迁 + 共享套件**:证词 commit 先补钉(绿于现行手抄
   JSX);共享套件工厂住 packages/reading-model/src/testing/(循
   wordLookupRaceSuite/settleRaceSuite 先例),共享主张一遍书写,两宿各以
   自己的 statusOf 形态(positional / lookup)挂载各跑;宿侧既有钉零改写
   证明真实接线。验收矩阵:多句夹 plain 块、跨句索引复位、同词不同位状态、
   null/错长/空 slot、position=0 与缺省、状态切换重渲、无回调、标注行
   缺省 vs 空值、键盘委托(Enter/Space/他键/非词目标/preventDefault/非零
   矩形坐标)、a11y(role="button"/tabIndex)、settled-tint 判别、CSS 接线
   联合检查(两 selector + 声明、两宿 @import、DOM class 发出、web 副本
   删除、generated 新鲜度)。
7. **Q7 票目 = spec-as-ticket 单票、三个 commit**:①刻画现状(证词钉,
   全绿于现行手抄 JSX);②纯迁移(宿换内核引用,既有断言零动——迁移零
   行为变化的证据链);③CSS 修正 + web 副本删除 + export 再生 + 新增声明
   钉(ext 行为变化记 Comments)。
8. **Q8 选道 = Lane B**:Codex 沙箱(workspace-write)实现,双轴评审;
   全链 verify 留编排侧。

## 方案

- 新模块 `packages/reading-model/src/react/annotated-blocks.tsx`(命名可在
  同形内斟酌):输入类型(决策 3 的 union + `StatusReader`)、句子块渲染
  (自跑 segmentOriginal、ipa-line fallback 与译文行按三值语义与 flag)、
  plain 三分支、委托工厂;react/index.ts 导出。`WordSegments` 为内核内部
  实现(或导出供套件用,实现自定)。
- web `ReadingView.tsx`:三块手抄体删除,改引内核;section 外壳、字号
  vars、memo、onWordClick 可选守卫(不挂 handlers 形态)、ReadingPage
  接口零动(`WordClick`/`ClickPoint` re-export 照旧)。
- ext `ReaderPage.tsx`:WordSegments/BlockView 手抄体删除,句子/三分支改引
  内核,`stateOf` 闭包进 `statusOf` 形;per-block 包裹 div、section、弹窗、
  目录分页零动。
- 测试:新共享套件工厂入 `packages/reading-model/src/testing/`;两宿宿侧
  新钉住各自测试文件;CSS 接线检查按决策 6 清单。
- commit ③:annotated-shared.css fragment 扩、style.css 副本删、generated
  再生(generated 产物改动与改源同 commit,再生明写)。

## Gate

- **零改写承诺**:web reading.test.tsx / wordLookup.test.tsx / domQueries、
  ext readerPage.test.tsx 既有断言零动(commit ② 验收)。
- 全链门禁:**caller 显式补跑** `npm run verify` EXIT=0(看退出码不看
  tail);测试计数以跑套件输出为准逐字抄,grep 只当下界。
- 评审基线 = 本票首个实现 commit 之前的 HEAD(写关系不写 SHA);双轴
  (Standards + Spec)一次覆盖。
- Codex 沙箱实现:禁 `git add`/`git commit`,改动留工作树;门禁与提交由
  编排会话执行(沙箱无网络是预期,非实现缺陷)。

## 人工检查点(caller)

1. commit ② 后(③ 前)补跑 `npm run verify`,确认迁移零行为变化证据链。
2. 全部 commit 后补跑全链 verify,双轴评审发起。
3. 收官:票面 Status 翻 done + Comments 记档 + docs commit。

## Comments

- 2026-11-03 (Claude): 立票。grilling 八锁(维护者「全按推荐」)+ Codex
  review-plan(gpt-6.1-sol/high read-only,threadId
  `01a19f8f-0a34-7640-95df-db4e46164768`,job `review-plan-mw05r8mr-gxbnpv`)
  NEEDS REVISION 11 发现全吸收(账目 plan.md §7;承重事实编排侧现场复核:
  pdf.ts:219 tabindex、annotation-lines min-height:1.4em、25 fragment 机制、
  export-style-fresh.test.ts 在位、exactOptionalPropertyTypes 开)。评审方
  独立跑通 typecheck + lint。ADR-0006 复用范围澄清(契约 6):本票把 React
  组件收进 reading-model/react,是该条款由 05a204d 开启的扩大路线的延续;
  ADR 文本本身不动。
