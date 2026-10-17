# 04: DeepSeek 译文行

**What to build:** 导入管线补上译文：通过 OpenAI 兼容接口调用 DeepSeek，把整本书的句子分批翻译成自然意译的简体中文，填入译文行。翻译器做成可注入的（供测试用假翻译器替换），单句失败不阻塞整本导入。key、基地址、模型名走服务端 .env 配置。

**Blocked by:** 02 Markdown 导入到句子块阅读（第一条曳光弹）

**Status:** ready-for-human

- [ ] .env 配置 DeepSeek 后，导入的书译文行显示自然的中文翻译
- [x] 句子按批请求而非逐句单发，带失败重试
- [x] 最终翻译失败的句子译文留空，导入正常完成
- [x] 翻译风格提示词（自然意译、学习者友好）在服务端配置中可调
- [x] 缝 1 测试用可注入假翻译器覆盖成功与失败两条路径，不打真实 API

## Comments

- 2026-10-17 (Claude): 实现。**缝**：`translate/translator.ts` 定义 `Translator`（批次形态 `translateBatch(sentences) → (string|null)[]`，契约 total——适配器永不抛错，够不着的批次整批报 null，导入只被延迟不被打断）。**编排**：`translate/batch.ts` 每批 20 句、失败句单独成批重试、最多 3 轮；空串/错位回复按失败计；轮次耗尽仍 null 的句子 `translation_text` 存 NULL，导入照常 201。**适配器**：`translate/deepseek.ts` 走 OpenAI 兼容 `/chat/completions`，编号行协议（回复按编号对齐、不按位置），系统消息=风格提示词（内置自然意译版，`DEEPSEEK_TRANSLATION_PROMPT` 整体替换）；`DEEPSEEK_API_KEY` 缺失则不配翻译器，与空词库留空音标行同一姿态。管线 `importMarkdownBook` 转 async，翻译在入库事务前完成；`fetch` 可注入供适配器单元测试。阅读端零改动（译文行早已渲染 translationText）。
- 2026-10-17 (Claude): 门禁全绿（退出码已验）：typecheck、49/49 测试（batch 编排 5 + deepseek 适配器 8 + API 缝假翻译器 3 + 原有 33）、lint、build。E2E 两路：① 本地 OpenAI 兼容 stub 全栈验证——真 server 进程（main.ts 读 env → 适配器 → 批翻译 → 入库 → API），逐句译文落库，批请求路径真通；② 真实 DeepSeek 路径 401：shell 导出的 `DEEPSEEK_API_KEY`（尾号 740e）已被 DeepSeek 判无效，且 `.env` 手写行变量名不匹配契约（`DeepSeek_key` 应为 `DEEPSEEK_API_KEY`，`DeepSeek_base URL` 含空格非法）——适配器按容错契约 401 重试 3 轮后放弃，导入正常完成、译文留空（失败路径实测）。**人工验收**：把 `.env` 变量名改为 `DEEPSEEK_API_KEY` / `DEEPSEEK_BASE_URL` / `DEEPSEEK_MODEL`（或换有效 key），重启 `npm run dev`，导入小书看译文行。
- 2026-10-17 (Claude): code-review(Standards+Spec 双轴)后修复:① `parseNumberedReplies` 收紧——只有批内编号(1..n)能开启条目,包行译文里的"1999. 12 月…"不再偷开槽位/搁浅尾行(新增越界编号测试,修复前实测红);② 补 messy-reply 固定件:中文顿号编号「1、」与折行续行并入(此前两条解析分支零覆盖,正是 CODING_STANDARDS"fixture 要照实数据形状"点名的票 03 模式);③ 管线重构:块行一次成型(单处 splitSentences、对齐从同一批行派生),章节平铺/游标切片移入 `translateChapters`(batch.ts),事务内单条 insert 路径;复核后不改:(database, dictionary, translator?) 三参随现有双参惯例穿三层,出第四个依赖再收 deps 对象;标题不作句子翻译系合同本义(标题是章节题,不是句子块);长导入走单个 POST 有 HTTP 超时风险,属票 08 进度/容错范畴(已转记)。验收框 1 取消勾选:真实 DeepSeek 路径仍差有效 key 的人工验证(401 见上),stub 全栈只证明代码路径。
