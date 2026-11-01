# status-join:wordStatuses 位置 join 升 reading-model 纯函数

Status: ready-for-agent

来源:architecture-review-20261101 候选 3(Worth exploring;报告 gitignore,
本票是候选的入档载体)。范围维护者已拍:只走纯函数路径;wire 带出 stateKeys
是行为变更,另票 `.scratch/wire-state-keys/spec.md`(needs-triage)。决策三锁
(2026-11-01,维护者「全按推荐」)。

## 问题(现场取数,2026-11-01)

「这次点词改了哪些词的显示」的领域规则——位置 join——内联在 web
`apps/web/src/ReadingPage.tsx:150-181`(`handleStatusApplied`,32 行):非
sentence 块透传 → `segmentOriginal(block.originalText, block.ipaSlots)` 重推
token 序、滤词段 → `wordStatuses[index]` 与 `applied.word`/`applied.lemma`
(非 null 时)精确串比对 → 命中位换 `applied.status`。规则无单测落点:仅整页
harness `apps/web/test/reading.test.tsx:795-903`(「withdraws the tint…」)
间接受测——精确串语义(大小写变体 `Woke` 不命中)钉在 :888-892,无关词
(`early` 既有 ignored 不被波及)钉在 :893,补丁本地生效(章节恰一次
refetch)钉在 :895-898。

同形漂移两处:`StatusApplied` 类型({word, lemma, status})住 react 子入口
`packages/reading-model/src/react/WordLookupPopup.tsx:10-14`,web
ReadingPage.tsx:150-154 与 ext `apps/extension/src/reader/ReaderPage.tsx:429-433`
各自内联同形(ext 的 status 字段用 VocabState 别名)。ext 渲染模型不同
(stateKey Map 写入,ReaderPage.tsx:429-441),位置 join 全仓只有 web 一份
(`wordStatuses.map` 仅 ReadingPage.tsx:169;ReadingView.tsx:48 是渲染只读
侧,不动)。

不变量散文三处:「顺序 = server tokenizeWords 序」——`apps/server/src/wire.ts:68-70`
(SentenceBlockPayload.wordStatuses 注释)、`apps/web/src/ReadingView.tsx:43-44`
(渲染侧 positional ride)、补丁侧无独立注释(闭包内联)。

server 权威(本票不动):`apps/server/src/vocab-store.ts:95-105`
tokenStatuses——为每个 token 算出 stateKey 又扔掉(stateKeys 另票的伏笔)。

## 已由代码定案(契约,不再决策)

1. **行为逐字上收**:精确串语义原样——`word === applied.word ||
   (applied.lemma !== null && word === applied.lemma)`;改折叠语义(如
   Woke→woke)是 spec 决策,本票不动(ADR-0005:前端渲染 verbatim、永不词形
   还原;本票不触任何 ADR)。
2. **react-locality 门禁**(`scripts/check-react-locality.mjs`,入 verify 与
   pre-commit)禁止根入口 import react、禁止 re-export 子入口符号 →
   `StatusApplied` 定义必须上收根入口;类型本身 react-free,上收即合法。
3. **BlockPayload 留在 wire**:ext 不消费 wire 块类型;reading-model 是
   「两宿共享规则」的家,不长出 ipaText/translationText 等传输形状。web 的
   `ChapterPayload["blocks"]` 联合类型经泛型保真进出,wire 文件零改动。
4. **ext 渲染模型不动**:stateKey Map 写入与位置 join 是两个模型;stateKeys
   合流是 wire-state-keys 票的事。

## 决策(三锁,2026-11-01「全按推荐」)

1. **类型进客 = 泛型结构化约束**:reading-model 自定最小结构形状,泛型
   `<B extends 形状>` 保返回 `B[]`;web BlockPayload 联合进出零适配。
2. **StatusApplied 上收 + 两宿改引**:定义迁根入口(住新模块),react 子入口
   re-export 保兼容;web/ext 两处内联形状改引之;ext VocabState 别名照旧;
   零行为。
3. **wire/stateKeys 另票**:立 `.scratch/wire-state-keys/spec.md`
   needs-triage stub(问题 + server 证据 + 待拍决策),本票不碰 wire。

## 方案

- 新根入口模块 `packages/reading-model/src/status-join.ts`:
  - `export type StatusApplied = { word: string; lemma: string | null; status: WordStatus }`(自 react 子入口迁入);
  - 最小结构形状类型(命名可斟酌,建议 `StatusJoinBlock`):`{ kind: string; originalText: string; ipaSlots?: string[] | null; wordStatuses?: (WordStatus | null)[] }`;
  - `export function applyStatusToBlocks<B extends StatusJoinBlock>(blocks: readonly B[], applied: StatusApplied): B[]`——`kind !== "sentence"` 或无 `wordStatuses` 的块原样透传(同引用);sentence 块 spread 新对象(仅 wordStatuses 重排),输入数组与块对象均不可变;泛型 spread 保 B 不丢,无需 `as` 断言(循 CODING_STANDARDS row-level as 教训)。
- `packages/reading-model/src/index.ts` 导出 `applyStatusToBlocks`、
  `StatusApplied`、形状类型;react 子入口 `WordLookupPopup.tsx` 删本地定义改
  `import type { StatusApplied } from "../status-join.js"`,`react/index.ts`
  的 re-export 改引根模块路径(公开面零收窄)。
- web `apps/web/src/ReadingPage.tsx`:handleStatusApplied 塌成
  `setContent((current) => current ? { ...current, blocks: applyStatusToBlocks(current.blocks, applied) } : current)`,applied 参数类型改 `StatusApplied`;`segmentOriginal` 自 ReadingPage.tsx:3 的 import 随唯一调用点(:161)消失而移除(ReadingView 仍自用)。
- ext `apps/extension/src/reader/ReaderPage.tsx:429-433` 内联形状改引
  `type StatusApplied`(自根入口 import);VocabState 别名保留;stateKey 写入
  逻辑零动。
- testing 子入口(`packages/reading-model/src/testing/index.ts:18` 泛型
  Applied)不受影响,零改动。

## 单测(新 `packages/reading-model/test/status-join.test.ts`)

1. 表面串命中:applied.word 精确匹配位的 status 换新,他位不动;
2. lemma 命中:applied.lemma 非 null 时词 === lemma 的位换新;
3. lemma null:仅表面串参与;
4. 大小写变体不命中:`Woke` ≠ `woke`(钉住折叠不上收,对齐
   reading.test.tsx:888-892);
5. 非 sentence 块(code/raw/image)透传同引用;
6. 无 wordStatuses 的块透传(结构形状的防御分支);
7. 输入不可变:数组与块对象均不被改写;
8. ipaSlots null:仍按 WORD_PATTERN 切词对位(配对 false 不影响 join);
9. 词段数与 wordStatuses 数不一致:越界位 `words[index]?.word` undefined →
   保持原状态(现状行为)。

## Gate

- **零改写承诺**:web `reading.test.tsx`(含 :795-903 行为主钉)、
  `wordLookup.test.tsx`、ext `readerPage.test.tsx` 断言零动。
- 全链门禁:`npm run verify`(typecheck + test + lint + 4 locality 门 +
  manifest + build)EXIT=0;看退出码不看 tail。
- E2E 不入本票 gate:零行为重构,无服务端面变化;验收争议才走 browser-e2e。
- 评审基线 = 本票首个实现 commit 之前的 HEAD;双轴(Standards + Spec)一次
  覆盖。
- Codex 沙箱实现:禁 `git add`/`git commit`,改动留工作树;门禁与提交由编排
  会话执行(沙箱无网络,依赖安装/全链跑不了是沙箱预期,非实现缺陷)。
