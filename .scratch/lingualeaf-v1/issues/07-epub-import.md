# 07: EPUB 导入

**What to build:** 导入管线支持 EPUB：按 spine 顺序抽取章节、标题、段落与图片位置，走与 Markdown 相同的分句、音标、译文管线与数据模型，阅读体验完全一致。章节标题不生成句子块，图片保留占位显示。

**Blocked by:** 02 Markdown 导入到句子块阅读（第一条曳光弹）

**Status:** ready-for-agent

- [ ] 导入 EPUB 后章节划分与目录顺序正确
- [ ] 章节标题只作标题显示；图片在原位置有占位
- [ ] EPUB 与 Markdown 共用同一导入管线与数据模型
- [ ] API 缝测试：用小型样例 EPUB（含标题、多段落、图片）断言抽取与句子块结构
