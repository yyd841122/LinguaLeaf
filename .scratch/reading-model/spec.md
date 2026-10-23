# reading-model:标注书文件的第二前端升格为真源码

来源:architecture-review-20261022 候选 2(Strong · in-process)。
锚点为候选 1、3、4、5 落地后的现状:export 已「吃数据、不吃 database」
(book-store 的 ChapterData 进、HTML 出),wire 词汇已给出 types-only
共享的先例;本候选把共享推进到运行时与构建时各一半。

## 问题

点词查详情的 fold、弹层几何 clamp、词边界 pattern、句子块的逐词配对
骨架、文件名规则——六份知识,web app 与导出文件两个 tier 各存一份,
靠 "keep identical" 注释维系(三处注释自证);FILE_SCRIPT 本体是模板
字符串里的裸 JS:无 lint、无 typecheck、AI 不可导航。行为被实现两次,
也被测试两次(wordLookup.test.tsx 332 行 vs export.test.ts 的
FILE_SCRIPT 行为段)。

## 方案

新建 workspace 包 `@lingualeaf/reading-model`(packages/reading-model,
零依赖、浏览器导向),五条规则与 WordLookup 类型单源:

- word-pattern:`WORD_PATTERN`(ipa-line.ts 与 ReadingView 的两份合一)
- lookup-fold:`normalizeToken` / `normalizeLookupToken`(dictionary
  迁出、server re-export;FILE_SCRIPT 的 lookupKey 手抄副本票 02 收编)
- popup-anchor:五个 POPUP_* 常量 + `anchorPopup(point, viewport)` 纯
  函数(WordLookupPopup 与 FILE_SCRIPT 的两份 clamp 合一)
- speak:`speakWord`(wordLookup.ts 迁出;FILE_SCRIPT 的发音 handler
  票 02 收编)
- book-filename:`annotatedBookFilename`(annotated-book 与 download.ts
  sanitizeFilename 的两份合一;签名 `string | null`,空名回落 book.html)
- sentence-segments:`segmentOriginal(originalText, ipaSlots) →
  { paired, segments }`——逐词走查 + 槽位配对判定(ReadingView 的双次
  matchAll 与 renderSentenceBlock 的走查合一;两前端各自把 segments
  渲染成 JSX / HTML 字符串,转义差异留在各自前端)

web 运行时 import(React 照旧);导出文件的行为半部升格为包内 TS
entry(export-front.ts:开关 + localStorage 卫兵、词表 JSON 解析、
弹层接线、外点/Escape 关闭、发音按钮),esbuild 在构建期把它编译成
IIFE 字符串,生成物 file-script.generated.ts 提交入库,annotated-book
模板内联。

## 决策

1. **真 workspace 包,不是 wire.ts 式 server 内相对共享**:web 这次要
   import 运行时代码,types-only 相对路径先例不覆盖;file-front entry
   需要 DOM lib,放 server src 会污染 server tsconfig 的 lib;NodeNext
   + rootDir=src 令 server 无法越界相对引用 → 包必须产出 dist,
   "prepare" 钩子(install 后即有 dist)+ 根脚本显式排序保证时序。
2. **生成物提交入库 + 显式新鲜度门禁**:build-file-script.mjs 支持
   --check(内存编译与提交产物逐字节比对,漂移即红并指路重新生成),
   镜像 check-sql-locality 的工效;生成物进 .prettierignore 与 eslint
   ignores。不用 pretest 静默重生成——提交产物的新鲜度是门禁,不是魔法。
3. **es5 target,entry 禁 async**:延续手写 FILE_SCRIPT 的 ES5 保守
   (双击 file:// 的最广可达);entry 不用 async/generator、不走 for-of
   (\p{} 正则不进 entry——词边界 pattern 只活在 markup 烘焙侧与两个
   真前端,FILE_SCRIPT 无运行时副本,与现状一致)。
4. **行为信封逐字节不动**:export.test.ts 的 JSDOM 行为测试断言零改动
   (弹层、开关、发音、miss、自包含红线);DOM id/class、localStorage
   键、导出 CSS 产出值(18rem / 16rem / calc(100vw - 1rem))全不变。
5. **样式表不入包**:无 CSS 管线,视觉样式是各前端自有——web
   style.css 保持手写镜像(注释改指包常量);导出样式表是 TS 模板,
   可从常量插值(产出值不变)。包共享的是行为几何(clamp 数学),
   不是视觉。
6. **WordLookup 类型随 fold 入包**:它是词表 JSON 的 value 契约,
   server dictionary 与 web wordLookup 双 re-export(wire.ts 先例的
   包侧版)。

不推翻 ADR-0003:共享发生在构建期,读取期仍是零依赖单文件;ADR 自己
写的「导出 HTML 与阅读页是同一数据模型的两个前端」——本候选让这句话
在源码层面成真。

## 门禁

实现 commit:`npm run typecheck && npm test && npm run lint` 绿;票 01
的 web/server 既有套件、票 02 的 export.test 断言零改动(信封)。
收尾 `npm run verify` 全绿(看退出码)。评审基线 = 实现票第一个 commit
之前的 HEAD。
