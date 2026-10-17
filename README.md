# LinguaLeaf

英文电子书标注阅读器的 TypeScript monorepo。目前仅提供 Express + SQLite 服务端、React 前端与两条测试缝的骨架，不包含导入、标注或点词查详情等业务功能。领域术语见 [GLOSSARY.md](GLOSSARY.md)。

需要 Node.js 22.12+（建议 Node.js 24 LTS）与 npm。`better-sqlite3` 通常使用预编译包；没有对应平台的预编译包时，需要 Python 3 和 C/C++ 编译工具。

```sh
npm install
npm run dev
```

打开 <http://localhost:3000>。Express 同一进程挂载 Vite，API、前端与 HMR 共用端口 3000；通过电脑的局域网 IP 和同一端口也可访问。修改前端会热更新，修改服务端会自动重启。

可复制 `.env.example` 为 `.env`，配置 `HOST`、`PORT`、`DATABASE_PATH`；默认监听 `0.0.0.0:3000`，数据库保存在仓库根目录的 `.data/lingualeaf.sqlite`，相对数据库路径以仓库根目录为基准。`GET /api/health` 检查 SQLite 连接并返回 `{"status":"ok"}`。

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
- `npm run test:watch`：监听两条测试缝；`npm test -- --project api` 或 `--project reading`：单独运行一条测试缝。

后续测试延续这两条缝，覆盖外部可观察的输入和输出。
