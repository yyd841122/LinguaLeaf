# LinguaLeaf

英文电子书标注阅读器的 TypeScript monorepo。目前仅提供 Express + SQLite 服务端、React 前端与两条测试缝的骨架，不包含导入、标注或点词查详情等业务功能。领域术语见 [GLOSSARY.md](GLOSSARY.md)。

需要 Node.js 22.12+（建议 Node.js 24 LTS）与 npm。`better-sqlite3` 通常使用预编译包；没有对应平台的预编译包时，需要 Python 3 和 C/C++ 编译工具。

```sh
npm install
npm run dev
```

打开 <http://localhost:3000>。Express 同一进程挂载 Vite，API、前端与 HMR 共用端口 3000；通过电脑的局域网 IP 和同一端口也可访问。修改前端会热更新，修改服务端会自动重启。

## 词库导入（音标行与查词 API 的数据源）

服务端的音标与查词全部走本地词库 `.data/dictionary.sqlite`（可用环境变量 `DICTIONARY_PATH` 改路径），由两个可重复执行的导入脚本灌入：

1. **ECDICT**（词性、中文释义、词形还原索引）——下载 [ECDICT 1.0.28](https://github.com/skywind3000/ECDICT/releases/tag/1.0.28) 的 `ecdict-sqlite-28.zip`，解压得到 `stardict.db`：

   ```sh
   npm run dict:import-ecdict -- /path/to/stardict.db
   ```

2. **ipa-dict en_US**（美式 IPA，125k 词条，MIT）——下载 [ipa-dict](https://github.com/open-dict-data/ipa-dict) 仓库的 `data/en_US.txt`：

   ```sh
   npm run dict:import-ipa-dict -- /path/to/en_US.txt
   ```

音标行的解析顺序：ipa-dict 美式音标 → 词形还原后再查 → ECDICT 自带 phonetic（英式为主）兜底；都查不到的词在音标行留空。ECDICT 官方数据只有英式为主的单一 `phonetic` 字段，故美式 IPA 以 ipa-dict 为主源（2026-10-17 决策）。两个脚本都可重复执行（幂等），重跑不会产生重复词条。

`GET /api/lookup/:word` 在词库就绪后返回 `{ word, lemma, ipa, pos, translation }`；词库为空或查不到时返回 404。

可复制 `.env.example` 为 `.env`，配置 `HOST`、`PORT`、`DATABASE_PATH`；默认监听 `0.0.0.0:3000`，数据库保存在仓库根目录的 `.data/lingualeaf.sqlite`，相对数据库路径以仓库根目录为基准。`GET /api/health` 检查 SQLite 连接并返回 `{"status":"ok"}`。

## 译文（DeepSeek 按章翻译）

导入只注音标（ADR 0004）：书入库即有音标与句子块，译文为空。译文按章按需生成——在阅读页对某一章点「翻译本章」，服务端通过 OpenAI 兼容接口调用 DeepSeek，把该章句子分批翻译成自然意译的简体中文。在 `.env` 中配置：

```sh
DEEPSEEK_API_KEY=sk-...            # 必填；不配置则导入不受影响，阅读页「翻译本章」按钮置灰并提示，配置后重启即恢复
DEEPSEEK_BASE_URL=https://api.deepseek.com   # 可选，任何 OpenAI 兼容端点
DEEPSEEK_MODEL=deepseek-flash      # 可选
DEEPSEEK_TRANSLATION_PROMPT=...    # 可选，整体替换内置的翻译风格提示词（自然意译、学习者友好）
```

行为约定：句子按批（每批 20 句）请求而非逐句单发；请求失败自动重试（失败句单独重试，最多 3 轮）；最终翻译失败的句子译文留空，章节照常标记为已翻译。已翻译的章可再次点「重新翻译」覆盖旧译文。阅读侧：整章尚无任何译文时不渲染译文行、显示设置里的「译文行」开关置灰；个别句留空仍显示空占位行，开关照常可用；导出不设「先翻译才能导出」的门槛，缺译文处省略译文行。

```sh
npm run build
npm start
```

构建结果位于 `.output/server` 与 `.output/web`。生产环境同一 Node 进程提供 API、前端静态资源，以及 `/`、`/book/:id/:chapter` 的应用入口。生产启动前必须构建；无需独立启动 Vite。生产部署需保留根目录 `package.json`、安装的运行依赖、`.output` 与数据库目录。

```sh
npm run typecheck
npm test
npm run lint
```

- `apps/server`：Express、better-sqlite3；`test/api.test.ts` 用 Supertest 从 HTTP API 验证行为，每个测试使用独立的内存 SQLite。
- `apps/web`：React、Vite；`test/reading.test.tsx` 用 Testing Library + jsdom 验证阅读界面组件的可见输出。
- `apps/extension`：浏览器扩展（MV3，Edge load-unpacked）——扩展阅读页，本地标注（ADR-0006）；加载与边界见 [apps/extension/README.md](apps/extension/README.md)。
- `packages/reading-model`：两个阅读前端共享的模型与规则（分词、音标配对、弹卡定位、发音）。
- `packages/import-core`：导入链的浏览器安全半（EPUB 解包/HTML 抽取/分句/音标槽/拒绝词表），服务端与扩展共用。
- `npm run test:watch`：监听各测试缝；`npm test -- --project api` 等按名单独运行。

后续测试延续这些缝，覆盖外部可观察的输入和输出。
