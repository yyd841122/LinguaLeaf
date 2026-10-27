# popup-status-backedge:弹窗四态操作的 back edge——状态事实交回页面属主

来源:2026-10-25 架构评审候选 4(`.scratch/architecture-review-20261025-164316.html`),
出参形状决策与维护者对齐锁定(2026-10-27,见 Comments)。单票体量,本 spec 即票
面骨架。前置候选 1(wire 载荷形状单源)已落地——patch 的对象(wordStatuses)
已有类型级家,本票解锁。

## 问题

词查弹窗 module 的操作状态机收得很好(竞态修法 locality 正确),但 interface
出参宽度为 0(`WordLookupPopup` props 仅 `{ click, onClose }`):四态操作 PUT
200 后的事实到弹窗为止——弹窗只 patch 自己的 pressed 态,页面载荷
(`ChapterPayload` blocks 的 `wordStatuses`)无从知晓。GLOSSARY「已掌握:阅读中
该词收回查词底色提示」在本章内只兑现 fetch 快照一半:点掉一个词,底色要等下次
路由重取载荷才收回。弱化 fixture 与弹窗 pressed 两组测试之间没有通路,因为
interface 不允许。

## 现状核对(2026-10-27,落票时逐点验)

- `apps/web/src/WordLookupPopup.tsx:46-52` props `{ click, onClose }`,出参宽 0。
- `applyStatus`(:87-96):PUT 键 = `state.lookup.lemma ?? state.lookup.word`
  (「States key on the lemma」自注);200 后仅 patch 弹窗内 pressed 态;
  `stale()`(currentWordRef 比对)挡跨词 patch;失败路径 setSaveFailed。
- `apps/web/src/ReadingPage.tsx:23` `content: ChapterPayload | null` useState;
  :69 fetch 填充;:97-98 翻译 tick 以 `{ ...current, ...state }` 结构化 patch
  (本票 patch 循此先例)。
- `wordStatuses` 对齐:wire-payload-shapes 决策 3 的对齐钉
  (`wordStatuses.length === segmentOriginal(originalText)` 词数);web 侧可对
  任意 block 重分词得词表——surface 匹配可行,无需新载荷字段。
- `WordStatus = "learning" | "known" | "ignored"`(server wire.ts:72);
  载荷项可空(`(WordStatus | null)[]`)。
- 客户端无词典引理数据:屈折变体(ran/running→run)的 index 页面找不全,
  客户端 patch 的匹配域只能 = surface 词 + 引理字符串(见决策 2)。

## 决策(锁定)

1. **出参形状 = 窄回调单 prop**:弹窗加一条
   `onStatusApplied(applied)` prop,载荷三字段
   `{ word: string; lemma: string | null; status: WordStatus }`
   (word = 点击 surface 形;lemma = 弹窗 lookup 的 lemma,可空;与 PUT 同源)。
   不做事件对象/事件总线;页面决定怎么 patch。(评审方向「收敛属主,不预设
   形状」;维护者锁「窄回调」,载荷字段较口头的 `(lemma, status)` 多 surface
   word 一项——同形词全 index patch 需要,见 Comments 修正记档。)
2. **页面 patch 语义 = 字符串匹配域,非引展开**:PUT 200 后页面结构化 patch
   `content` 各 sentence block:对 `segmentOriginal(originalText)` 重分词,
   `word === applied.word || word === applied.lemma`(lemma 空则跳过该路)的
   index 置 `applied.status`。被点词及其全部同形出现即时生效;屈折变体客户端
   无引理数据找不到,维持现状(下次路由由载荷事实生效)——与今日一致,不算
   本票义务。
3. **事实与视野分离**:出参在 PUT 200 后**无条件**触发(闭包捕获点击时的
   word/lemma/status,弹窗期间换词不吞)——`stale()` 守卫只继续挡弹窗本地
   pressed 态 patch。事实属于词,不属于弹窗当前视野。
4. **失败与进行中不上报**:PUT 非 200 / 在途不触发 out-param(弹窗内
   saveFailed 既有认账不变)。
5. **不捆 async 守卫收编**:弹窗 `currentWordRef`/`stale()` 换共享
   owner-token module(评审候选 5)留独立票,循「重构与行为变化是两个
   change」先例。
6. **载体与门禁**:cc-suite `/implement` 实施 + 双轴 review(Standards /
   Spec);评审基线 = 本票首个实现 commit 之前的 HEAD(钉关系不钉 SHA);每个
   实现 commit typecheck && test && lint 绿(看退出码不看 tail);收尾
   pre-commit 全门禁绿。Codex 沙箱禁 socket 照 `.cc-suite.md` 预期处理,全量
   测试留编排侧。
7. **记档面**:零 ADR;GLOSSARY「已掌握/忽略」词条不动(语义兑现而非改口)。
   **本票含行为变化**:被点词底色收回从「等下次路由」变「立即」——这是产品
   语义补全(GLOSSARY 本意),票面勾选框记档,渲染变化不再另行走零变化红线。

## 实现既定(非决策,落票时写死)

- prop 必填(编译期逼全部调用点表态):ReadingPage 传真处理器;现有弹窗单测
  调用点补 spy/noop。
- 页面侧推荐直接 `setContent` 结构化 patch(循 :97 先例),不引入 overlay
  map;blocks 不可变更新。
- prop 命名 `onStatusApplied`;若实现时发现更诚实的名字可改,改名记票
  Comments。
