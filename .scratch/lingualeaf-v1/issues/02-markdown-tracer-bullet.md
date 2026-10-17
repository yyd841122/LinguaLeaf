# 02: Markdown 导入到句子块阅读（第一条曳光弹）

**What to build:** 第一条打通全层的垂直切片：上传一个 Markdown 文件创建书，服务端抽取章节与段落、分句、生成句子块入库（音标行/译文行此票留空）；书架页能看到该书，阅读页按句子块渲染三行结构。Markdown 按标题层级划分章节，标题不生成句子块；代码块与链接不标注。

**Blocked by:** 01 项目骨架与双缝脚手架

**Status:** ready-for-human

- [x] POST /api/books 接受 .md 文件，创建书并可在 GET /api/books 看到
- [x] GET /api/books/:id 返回目录（按标题划分的章节列表）
- [x] GET /api/books/:id/chapters/:n 返回该章句子块数组（音标/译文为空）
- [x] 阅读页按句子块渲染：每句一组三行，空行占位但结构完整
- [x] 标题只作章节标题显示；代码块、链接原样显示、不进句子块
- [x] API 缝测试：喂样例 .md，断言分句、目录与句子块结构

## Comments

- 2026-10-17 (Claude): 曳光弹打通。导入管线:markdown-it(html:false)→cheerio 抽取(与 EPUB 共用的同一路径,extract-html.ts)→分句→事务入库。分句用 sbd(Intl.Segmenter 在 Node 24/ICU 78 无 CLDR 缩写抑制,"Mr." 会被切开,已实测弃用)。章节划分:每个标题开新章,首个标题兼作书名,首标题前的内容进无标题引导章(空则丢弃)。代码块与含链接段落原样直通(kind: code/raw),不分句不标注,音标/译文列留 NULL。书架页含上传表单,阅读页三行结构+空行占位(min-height)+上下章导航;路由 react-router(/、/book/:id/:chapter)。
- 2026-10-17 (Claude): 门禁全绿:typecheck、13/13 测试(API 缝 9 + 组件缝 2 + 前端托管 2)、lint、build、生产与 dev E2E(curl --noproxy)。
