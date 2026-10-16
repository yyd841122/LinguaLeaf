# 01: 项目骨架与双缝脚手架

**What to build:** 可运行的 TypeScript monorepo 骨架：服务端（Node + Express + SQLite）与前端（React + Vite）各就各位，服务端同一进程托管 API 与构建后的前端；两条测试缝（服务端 HTTP API 缝、阅读界面组件缝）的测试设施可用。本票为后续所有票铺路，不包含任何 LinguaLeaf 业务功能。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] 一条命令可启动开发环境，一条命令可构建，typecheck 与测试可运行
- [ ] 服务端启动后 GET /api/health 返回 ok
- [ ] 前端开发服务器与构建产物均可通过服务端访问
- [ ] API 缝与组件缝各有一个示例测试通过
- [ ] 有简短的启动说明（README 或 CLAUDE.md）
