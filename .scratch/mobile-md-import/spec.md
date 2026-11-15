# mobile-md-import:手机端导入 Markdown 书(与 EPUB 面同权)

Status: tracked in issues/01,02(spec 不再单独作为票,实现状态读 issues/)
Lane: A —— Claude 实现,Codex read-only 审核(维护者 2026-11-15 grilling 时点名选 A)
基线: the HEAD before this ticket's first implementation commit(关系记法,不记 SHA)

## 背景

GLOSSARY「书」词条已宣称支持 Markdown(GLOSSARY.md:8:"支持 EPUB、Markdown,以及文本层
完好的 PDF(扫描件不支持)"),web/server 端的 Markdown 导入已上线(format-reader-registry
票建起的注册表已含 markdown 项)。手机端缺口:文件选择器只收 `.epub,.pdf`,`.md` 落入
epub 链后被谓词以 unsupported-format 拒绝。本票让手机端可导入 md 书,与 EPUB 面
逐项同权:书架、导入时离线词典注音、点词查详情+生词本、阅读进度/书签/笔记、按章按需翻译。

内容基准(grilling 拍板):纯英文文章/读物。元素语义与 web 端 md **完全一致**,
不为手机端发明第二套语义。

## 现状事实(2026-11-15 逐条对盘上源码重验,未转抄任何上游报告)

- `apps/server/src/import/markdown.ts`:`readMarkdownBook(filename, markdownText)`(:21)
  = `MarkdownIt({ html: false, typographer: false })`(:9).render → `extractChaptersFromHtml`
  (import-core 既有函数);`MARKDOWN_EXTENSION = /\.(md|markdown)$/i`(:12)与
  `isMarkdownFilename`(:14)同在此文件;书名 `deriveBookTitle(null, chapters, filename,
  MARKDOWN_EXTENSION)`(:30)——书自身首个标题,退文件名。
- markdown-it 依赖仅在 server:`apps/server/package.json:21`(runtime)与 :29(@types)。
  `packages/import-core` 不含 markdown-it,不导出任何 markdown 能力
  (`src/index.ts` 全文无 markdown 字样;定位注释自称"one chain, two hosts")。
- server 注册表 `apps/server/src/import/format-readers.ts`:READERS 已含 markdown 项
  (reader 以 `content.toString("utf8")` 适配 md 的文本入参);`UNSUPPORTED_FORMAT`
  文案已含 `.md, .markdown`。
- **md reader 无专属单测**:`apps/server/test/` 对 `readMarkdownBook` /
  `MARKDOWN_EXTENSION` / `isMarkdownFilename` 零直引(grep 2026-11-15);md 语义只被
  api.test.ts 的 `.md` 夹具(断言 `format: "markdown"`)与 epub-import.test.ts:241
  的 415 用例间接覆盖。元素语义属测试缺口,由本票验收 a 补上。
- mobile 选择器:`apps/mobile/src/reader/ReaderLanding.tsx:272` `accept=".epub,.pdf"`;
  可见文案 :269「选择一个 EPUB 或 PDF 文件,或把它拖进本页。」与 aria-label :273
  「选择 EPUB 或 PDF 文件」同写两格式;:306 的 `.json` accept 是备份导入,不相干。
- mobile 分流:`apps/mobile/src/reader/ReaderPage.tsx` handleFile 只按 `/\.pdf$/i`
  分 PDF;其余进 `importBookFromFile`(:315,传 `offline.ipaLookup()`)。`.md` 现状
  落入 epub 链,被 `import-book.ts:73` 的 `isEpubFilename` 谓词拒绝(:75-76 wire 体
  "the extension reader accepts EPUB files")。
- `apps/mobile/src/reader/import-book.ts` 与 `apps/extension/src/reader/import-book.ts`
  逐字节相同(`diff -q` IDENTICAL,2026-11-15);mobile 副本的用户可见文案仍写
  「扩展阅读页当前支持 EPUB 与 PDF」(:37)——手机上显示的就是这句,端词漂移。
- `ExtBook = { title, chapters }` 无 format 字段;docId = `doc:${book.title}`
  (ReaderPage.tsx:316 附近),`library.saveDocument({ id, title, book })` 原样可用
  ——**无存储迁移**。
- 按章翻译触发器在 `apps/mobile/src/reader/EpubReader.tsx:517-530`:按钮文案
  「翻译」,运行态「翻译中 N%」,完成态「已翻译」;key 未配置时按钮不可用
  (TranslateSettings.tsx:107)。句级翻译入口不做(`.out-of-scope/sentence-translation.md` 在案)。

## 决策(grilling 拍板 2026-11-15)

1. **只做手机端**。扩展不支持 md 的现状维持(另票候选,见 Out of scope)。
2. **入口零新交互**:accept 扩为 `.epub,.pdf,.md,.markdown`;可见文案改
   「选择一个 EPUB、PDF 或 Markdown 文件,或把它拖进本页。」,aria-label 改
   「选择 EPUB、PDF 或 Markdown 文件」。不做系统分享导入。
3. **解析器下沉 import-core**:`apps/server/src/import/markdown.ts` 整体
   (MarkdownIt 实例、MARKDOWN_EXTENSION、isMarkdownFilename、readMarkdownBook,注释随迁)
   迁为 `packages/import-core/src/markdown.ts`,`src/index.ts` 导出三者;markdown-it 进
   import-core package.json(runtime)、@types/markdown-it 进 dev;server 删除本地
   markdown.ts,format-readers.ts 改从 `@lingualeaf/import-core` 引用,package.json
   摘掉 markdown-it 两行。理由:import-core 定位即导入链的浏览器安全半,markdown-it
   纯 JS 可浏览器跑;避免再造第三份拷贝。**不立 ADR**(不难逆,本票在案即可)。
4. **mobile 分发收在 import-book.ts 内**:importBook() 的谓词从 isEpubFilename 改为
   "epub 或 markdown";md 分支 TextDecoder 解 utf8 → `readMarkdownBook(filename, text)`
   → 现有 `assembleBook`(句子块 + 离线词典 IPA 槽,复用入参 lookup)。ReaderPage 的
   PDF 分流不动(md 天然落 importBookFromFile 路径,预期零改动——若实现发现必须动,
   记 Comments 说明理由)。:75-76 的 wire 错误体同步改为如实描述(epub+markdown)。
5. **元素语义与 web md 一致**(md 经 html:false + 共享抽取的既定行为):
   标题→章(章名是目录结构,不进句子块流);段落/列表→句子块(注音、可翻译);
   围栏代码→code 块(不注音、不翻译);图片→占位块;链接段落→raw 块(不注音、不翻译);
   行内 md(粗体/斜体/行内代码)纯文本化进分句;md 内嵌原始 HTML 失活转义(html:false 既定)。
6. **能力逐项同权,零新增面**:书架项、导入时离线词典注音(零网络)、点词查详情
   (首次查词自动进生词本 learning)、阅读进度/书签/笔记、按章「翻译」按钮
   (用户自配 DeepSeek key)——全部复用 EPUB 面现成链路,md 无任何特殊化。

## 改动面

- `packages/import-core/`:新 `src/markdown.ts`(自 server 迁入);`src/index.ts`
  导出 readMarkdownBook / isMarkdownFilename / MARKDOWN_EXTENSION;package.json 加
  markdown-it + @types/markdown-it;新 `test/markdown.test.ts`(验收 a)。
- `apps/server/`:删 `src/import/markdown.ts`;`src/import/format-readers.ts` 改引
  import-core;package.json 摘 markdown-it/:types 两行;受影响测试改 import 路径。
- `apps/mobile/`:
  - `src/reader/import-book.ts`:谓词放开 + md 分支(决策 4);IMPORT_ERROR_COPY
    `unsupported-format`(:37)改「暂不支持这种文件——手机阅读器当前支持 EPUB、PDF
    与 Markdown。」(顺带修掉端词漂移"扩展阅读页");
  - `src/reader/ReaderLanding.tsx`:accept(:272)、可见文案(:269)、aria-label(:273)
    按决策 2 的新文案。
- 孪生文件注意:extension 的 import-book.ts 与 mobile 逐字节孪生(diff 已证),本票
  只改 mobile 侧,两份自此分叉;extension 补 md 与孪生去重均另票。

## 验收门

a. **import-core 单测**(新 `test/markdown.test.ts`):钉死决策 5 全部元素语义——
   标题分章、段落分句、code/raw/image 三类 plain 块、行内 md 纯文本化、内嵌 HTML
   失活、书名退文件名;`apps/server/test/format-readers.test.ts` 补一条 markdown 项
   委托断言(经 readUpload 产出 `format: "markdown"` 即可,不重复语义断言)。
b. **mobile 单测**(既有 vitest+jsdom+fake-indexeddb 缝,主战场 readerPage.test.tsx):
   md File 导入 → 书架项出现 → 打开见句子块与 IPA 槽;不支持扩展名仍走
   unsupported-format 且文案正确;同书名重导的替换确认(DocumentReplacementRequired)
   对 md 书同样生效。
c. **真机人验**(清单见下)——人的检查点。
全链 `npm run verify` 由 caller 在管线内显式补跑;`npm test` 的 pretest 重建语义照旧,
禁裸 `npx vitest`(会跑陈旧 dist)。

## 真机人验清单(白话;准备与"应看到"对照执行)

准备:电脑上建一个纯英文 `.md`(含几个 `##` 标题和多个段落),传到手机(微信文件助手、
USB 均可);在 LinguaLeaf 设置里填好翻译 Key。

1. 导入:打开书架页,点「选择 EPUB、PDF 或 Markdown 文件」按钮,选中这个 md。
   应看到:进入阅读,词下方出现音标行,无报错。
2. 分章:md 里有几个标题,就应看到分成几章,章名即标题文字,章间可切换。
3. 点词:点正文任意英文词。应看到:弹窗显示音标+中文释义;首次查过的词进了生词本。
4. 翻译:点章内「翻译」按钮。应看到:按钮变「翻译中 N%」,随后句子下方逐句出现
   中文译文行,按钮变「已翻译」。
5. 进度:读到中间,杀掉 app 重新打开,从书架进这本书。应看到:自动回到上次读到的位置。
6. 拒绝路径:选一个 .txt 文件。应看到:错误文案,且写的是"手机阅读器"(不是"扩展阅读页")。

## Lane A 管线(实现会话照此走,不自证清白)

1. Claude 实现,本地全链验证(相关测试面 + lint);
2. Codex read-only 独立审核:对照本票逐条 + 变异心证,循 CODING_STANDARDS
   「No-change claims…」;
3. Claude 裁决:修笔当场改,发现记档下方 Comments;
4. **caller(人)显式补跑 `npm run verify`**(退出码不等于 verify 门);
5. 真机人验(上方清单,人执行);
6. 收官 docs commit 翻 `Status: done`,wrap-up 报告与 threadId 记入 Comments。

## Out of scope

- 浏览器扩展补 md(import-book.ts 孪生去重可与之合并,另票 needs-triage);
- 系统分享导入(Android share intent);
- 句级翻译(`.out-of-scope/sentence-translation.md` 在案);
- mobile PDF 面任何变化(PDF 走逐行重排管线,与本票无关);
- md 内容形态扩展(表格渲染、图片显示、中英混排优化)——元素语义照 web 现行为,不新增。

## Comments

- 2026-11-15 grilling 定稿。Lane pick:A(维护者点名)。票面全部 file:line 与
  文案于写票当日对盘上源码重验,未转抄上游勘察报告。
