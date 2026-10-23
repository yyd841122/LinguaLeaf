# translation-join:翻译回填从数下标到对象同一性

来源:architecture-review-20261022 候选 6(Speculative · in-process)。
报告行号基于 book-store 落地前的 main;锚点已重定位:两次遍历如今都在
import-task.ts(收集 33-37、回填 57-66),pipeline.ts 只负责建块。
Speculative 而现在做:它坐在句对齐这条最毒的静默 bug 轴上,而 book-store
落地后改动成本已降到一次局部重构 + 一个测试文件。

## 问题

「第 i 个句子块 ↔ 第 i 条翻译」由 import-task.ts 里两次独立的过滤遍历
靠计数维持:第一次 `filter(kind === "sentence").map(text)` 收集译文输入;
翻译回来后第二次重新 filter + 手数 sentenceIndex 回填。类型上没有任何
东西绑定翻译与块——任一遍历改动(如收集侧跳过空句)而另一侧不改,
错位是静默的。合并逻辑也没有自己的测试面:runImportTask 只被
books-router 以 `void` 触发,现有翻译测试全走 HTTP seam(api.test.ts
三连),没有任何测试断言过「混排章节里翻译落在正确的句子块上」。

## 方案

收集一次句子块引用(`sentenceBlocksByChapter: BlockRow[][]`),翻译输入
在调用边界 `map(block.text)` 即得;回填走这组引用就地填
`block.translation`——join 从「两次独立计数」变成对象同一性:回填侧
不再有第二个可漂移的过滤,与 chapterBlocks / persistBook 的共享靠引用。
runImportTask 的 deps 本就是注入的(database、dictionary、translator),
直测缺的只是一个测试文件:内存 SQLite + createFakeTranslator + 手搭
混排 PreparedBook,直接 await,无需轮询。

## 决策

1. **不把 BlockRow 拖进 translate/**。Translator 的 seam 是文本(LLM
   说的就是文本),batch.ts 的纯 string 形状有自己的一套测试;引用的
   持有与回填是编排知识,留在 import-task.ts。
2. **回填就地改引用,不复制新数组**。chapterBlocks 持有的对象就是
   persistBook 收到的对象;任何「收集 → 平铺 → 按下标拼回」都在重建
   第二条可漂移的通路。
3. **章级 `?? []` 守卫保留、句级 `?? null` 不动**。translateChapters
   的形状契约由 batch.test.ts 钉住,但编排自身的 total 不指望下游;
   翻译失败留空是已有 pinned 行为,不在此票改。
4. **直测夹具手搭 ContentItem 混排,不走 markdown 前半**。join 的测试
   要的是精确的块序列(paragraph 两句 / image / code / paragraph 一句),
   解析器形状是另一层测试的事。

## 门禁

每个实现 commit:`npm run typecheck && npm test && npm run lint` 绿
(看退出码,不看 tail);收尾 `npm run verify` 全绿。行为信封:现有
api.test.ts 翻译测试零改动全绿即是重构安全的证明;新直测不与 HTTP
测试重复断言同一形状,只钉它们看不见的混排 join。
