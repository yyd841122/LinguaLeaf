# 07: EPUB 导入

**What to build:** 导入管线支持 EPUB：按 spine 顺序抽取章节、标题、段落与图片位置，走与 Markdown 相同的分句、音标、译文管线与数据模型，阅读体验完全一致。章节标题不生成句子块，图片保留占位显示。

**Blocked by:** 02 Markdown 导入到句子块阅读（第一条曳光弹）

**Status:** resolved

- [x] 导入 EPUB 后章节划分与目录顺序正确
- [x] 章节标题只作标题显示；图片在原位置有占位
- [x] EPUB 与 Markdown 共用同一导入管线与数据模型
- [x] API 缝测试：用小型样例 EPUB（含标题、多段落、图片）断言抽取与句子块结构

## Comments

- 2026-10-18 (Claude): 实现。**EPUB 前半**（import/epub.ts）：JSZip 解压 → container.xml → OPF → 按 spine 顺序取各文档 body，每文档走与 markdown-it 输出相同的抽取路径（extractChaptersFromHtml）。**每个 spine 文档即章节边界**（code-review 后修正：原实现按标题切章，无标题文档会并入邻章）——有标题的文档内部继续按标题细分，无标题文档（封面/扉页）按 `<head><title>` 自成一章，空文档跳过；书名 dc:title → 首个标题 → 文件名（与 Markdown 共用 deriveBookTitle）。**图片**：抽取器改为递归容器元素（div/section/figure/ul/ol/blockquote，EPUB 正文都在包装层里），img → `image` 块（alt 入 original_text），段落内联游走保证占位块落在句子之间的原位；figcaption/li 按普通段落标注（说明文字是散文）。**数据模型**：blocks.kind 增 `'image'`（标注列全 NULL）；CHECK 无法 ALTER，openDatabase 对旧库原地重建 blocks 表（逐行保留，schema.test 固定），ipa_slots 迁移先于重建执行。**前端**：阅读页 image 块渲染占位 figure（🖼 + alt 说明文字），书架 accept `.epub`，415/400 分态提示。坏文件：非 zip / 无 container / 无 OPF / spine 文档缺档（code-review 后从静默跳过改 400）→ 400；非 .epub/.md → 415。**测试**：API 缝 12（样例 EPUB：spine 顺序目录、dc:title、句子/图片块结构、假翻译器证同一译文管线；乱形状：URL 编码 href、无标题文档、无 dc:title、spine 缺档、坏 zip、纯 zip 假 epub）+ 组件缝 1（占位渲染与位置）+ 迁移 1（旧行保留 + 新 kind 可写）+ 提交二进制与构造器字节一致 1（构造器固定时间戳、去目录项，防漂移）。**门禁**（退出码已验）：typecheck、103/103、lint、build（npm run verify 一把过）；生产 E2E（--noproxy，空 DEEPSEEK_API_KEY 关翻译）：sample-book.epub 201 → 目录 spine 顺序 → 第 2 章 sentence/image/sentence/image/sentence、真词库 IPA；坏 epub 400；删书 204。**code-review 双轴**后修复：① 乱形状 fixture 补齐（原样例全干净形状，CODING_STANDARDS 硬伤）；② 书架 400 单独提示「文件无法解析」，不再误导重试；③ 章节划分改 spine 边界；④ spine 缺档 400；⑤ deriveBookTitle/BlockKind/415 body 三处重复收敛；⑥ 二进制 fixture 防漂移测试。复核后不改：schema.test 直测迁移层——仓库先例（dict-import/dictionary/translate 单测）允许缝外单测；共享抽取路径对 markdown 平铺输出的语义不变（样例书全量断言未动）。**人工验收提示**：`apps/server/test/fixtures/sample-book.epub` 可直接书架上传；确认插图位置显示占位框、目录与 spine 顺序一致。
- 2026-10-18 (yyd841122): 人工验收通过 —— 先用真实 EPUB《Wonder》(148 章、14 图)验证了结构:spine 顺序、章节划分、图片占位全部正确;后导入英文书《The Quiet Value of Patience》(7 章 44 句)测试阅读正常(音标/译文/占位)。注:第一本真书是意大利语版(下载错版),顺带确认了非英文书不会被拦截——英文词库撞词会给出误导性音标(词级 59% 假覆盖),v1 按 spec 不管,后续候选项:导入时非英文检测提醒、目录无标题文档显示「第 N 章」(真书前部 spine 文档 <title> 是文件名)。
