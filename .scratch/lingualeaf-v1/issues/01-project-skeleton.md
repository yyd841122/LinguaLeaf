# 01: 项目骨架与双缝脚手架

**What to build:** 可运行的 TypeScript monorepo 骨架：服务端（Node + Express + SQLite）与前端（React + Vite）各就各位，服务端同一进程托管 API 与构建后的前端；两条测试缝（服务端 HTTP API 缝、阅读界面组件缝）的测试设施可用。本票为后续所有票铺路，不包含任何 LinguaLeaf 业务功能。

**Blocked by:** None (can start immediately)

**Status:** ready-for-human

- [x] 一条命令可启动开发环境，一条命令可构建，typecheck 与测试可运行
- [x] 服务端启动后 GET /api/health 返回 ok
- [x] 前端开发服务器与构建产物均可通过服务端访问
- [x] API 缝与组件缝各有一个示例测试通过
- [x] 有简短的启动说明（README 或 CLAUDE.md）

## Comments

- 2026-10-16 (Claude via Codex `gpt-6.1-sol`): 骨架实现完成 — Express + better-sqlite3 服务端、React 19 + Vite 7 前端、同进程托管、两条测试缝(Supertest HTTP 缝 / Testing Library + jsdom 组件缝)。验收全部通过:typecheck、lint、5/5 测试、生产与 dev 端到端(`/api/health` ok、构建产物与 Vite HTML 均经同一端口)。
- 实现后修复两处:① dev 缝测试移除 `/src/main.tsx` 请求(vite.close() 在依赖优化中于 vitest worker 内死锁,React 转换已由组件缝覆盖);② `frontend.ts` 改用 `configLoader: 'runner'`,消除 Vite `.vite-temp` 临时文件触发的 `--watch` 无限重启。
