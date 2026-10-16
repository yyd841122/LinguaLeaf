# 复用调研（2026-10-16）

> 结论：核心功能（句子块对照阅读 + 标注开关）无现成开源实现，需自研；
> 外围管道件全部有成熟现成方案。调研由 /grill-with-docs 会话中用户发起。

## 直接复用（零代码）

- **ECDICT** — https://github.com/skywind3000/ECDICT
  词库数据：phonetic（音标）/ translation（中文释义）/ definition（英文释义）/ pos（词性）/ 词频。
  有打包发布版（1.0.28, 2025-11）。变体：ECDICT-ultimate。**用时确认数据许可条款。**
  喂饱：音标行 + 点词查详情。
- **foliate-js** — https://github.com/johnfactotum/foliate-js
  EPUB 解析/取文（epub.js 已停维护，此为社区公认继任者，活跃）。
  只用解析层；自定义句子块视图不用其翻页渲染器。
- 生态件：SQLite、markdown-it（或同类）、JS 断句库（sbd / wink-nlp）、React + Vite + Node。

## 借鉴思路（读代码，不引依赖）

- **bilingual_book_maker** — https://github.com/yihong0618/bilingual_book_maker
  LLM 整本翻译 epub/md/txt 的先行项目：分批、重试、提示词写法。Python CLI，栈不同不直接用。
- **koodo-reader** — https://github.com/koodo-reader/koodo-reader （AGPL-3.0 ⚠️ 只看交互，禁止复制代码）
  书架/进度/阅读设置交互参考。**Readest** — https://github.com/readest/readest （Next.js 版 Foliate）同类参考。

## 自研（无现成轮子）

句子块视图（原文行/音标行/译文行 + 显示开关）、导入管线（EPUB/MD → 分句 → ECDICT → DeepSeek 批量翻译 → 入库）、
点词查详情（词形还原 + 弹窗）、书架/进度/字号。

## 同类项目（不覆盖核心功能）

- **Lute v3** — https://github.com/LuteOrg/lute-v3 （Python/Flask 自托管，MIT）
  通过阅读学语言：点词查词典、生词管理（≈ 我们 v2 生词本），但无逐句音标行/译文行。
- **ipa-dict** — https://github.com/open-dict-data/ipa-dict
  纯 IPA 词表数据，可作 ECDICT 音标缺失时的兜底数据源。

## 用户补充调研复核（2026-10-16，另一来源的 6 项目清单）

经 GitHub API 逐一验证，6 个仓库均真实存在。按对本项目价值重排：

**借鉴**：
- Readest（⭐25.3k，AGPL-3.0，TypeScript，活跃）— 书架/目录/设置交互参考；禁抄代码。
- 沉浸式翻译（商业产品）— 译文行双语混排 + 翻译开关呈现，核心交互最对口的参考。
- bilingual_book_maker — 已收录（上节）。
- Lexora（mkvSKYi/Lexora，⭐1，Kotlin/Compose/Readium，EN→UK）— 点词卡片/词汇收藏 UX 思路；v2 生词本时再参考；无许可证=代码不可复用。

**不投入**：
- ajargrey/ipa-reader（⭐0，无许可证）— 贴文标"★★★★★"但实为个人小项目；仅五分钟扫一眼音标排版。
- DrLoki/GianoReader（⭐30，许可证不明，Google Translate 集成）— 价值低。

**贴文策略纠偏**（与已拍板设计冲突）：其 MVP 假设为"分页 ReaderEngine + 实时选句翻译 + IndexedDB 纯前端"，
本项目实为"句子块流式视图 + 导入时整本预生成 + Node 服务端 SQLite"。勿混用。

**新分支**：点词弹窗加发音按钮（浏览器 Web Speech API）——待用户确认是否进 v1。

## 后续修正（spec 阶段）

- **foliate-js 从 v1 依赖中移除**：我们的阅读界面渲染的是库里的句子块数据，从不渲染原始 EPUB 版式，
  因此 foliate-js（浏览器 DOM 依赖）没有落点。EPUB 解析在服务端导入管线用 JSZip + cheerio 完成。
- koodo-reader / Readest 仍是交互参考；bilingual_book_maker 的翻译管线思路仍适用（语言无关）。
