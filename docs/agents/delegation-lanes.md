# Implementation lanes: Claude ↔ Codex 分工

Feature/refactor tickets run through one of two implementation lanes. Pick
per ticket at grilling time; the pick (and any mid-flight flip) is recorded
in the wrap-up Comments. Both lanes keep the same invariant:
**实现者 ≠ 评审者** — the implementation side never certifies its own work.

## Lane A — Claude implements, Codex reviews

编排会话(Claude)直接实现,完成后交 Codex 独立审核。

- 选道时机:实现涉及沙箱做不到的事(Windows interop、宿主网络、跨进程),
  或维护者点名翻转(settle-channel 01 即实例:纯 TS/React 但维护者选 A)。
- 管线:立票(ready-for-agent)→ Claude 实现(本地全链验证)→ Codex 审核
  (read-only 沙箱,对照票面逐条 + 变异心证,循 CODING_STANDARDS「No-change
  claims…」)→ Claude 裁决:修笔当场改、记档进票面 Comments → caller 显式
  补跑 `npm run verify`(退出码不等于 verify 门)→ 收官 docs commit 翻 done。

## Lane B — Codex sandbox implements, 双轴评审

Codex 在 workspace-write 沙箱按票面自主实现,双轴评审兜底。

- 选道时机:纯 TS/React、票面自包含、沙箱内可验证(word-lookup-kernel、
  jump-target-protocol、status-join 均此道)。
- 沙箱限制:`.cc-suite.md` 项目指令已声明——HTTP seam 测试 listen EPERM 是
  假失败,不修;全量测试与 verify 留编排侧补跑。
- 管线:立票 → `/cc-suite:implement`(或 codex-runner 直调)→ Codex 返回
  threadId → 编排侧补跑全链 verify → 双轴评审(Standards/Spec 并行)→
  收官。
- 守态:`--background` 任务的终态用 `.claude/scripts/watch-codex-job.mjs <jobId>` 守(挂
  Bash run_in_background,终态一行 TERMINAL 唤醒编排会话)。禁手搓 until-loop:内联带
  引号 JS 曾 SyntaxError 空转数小时(settle-channel 02);脚本头注释带干跑口诀(先
  `timeout 3` 验退出码 124,注入 fixture 可验终态路径)。

## 共同纪律

- **票面自包含**:实现会话零依赖编排会话上下文;决策、验收门、人工检查点
  (caller 补跑 verify、翻 Status)全写在票面,不靠会话记忆。
- **threadId 入档**:Codex 每次实质产出(计划评审 review-plan / 实现 /
  审核)的 threadId 记进 commit message 与票面 Comments——`/cc-suite:continue`
  续会话与日后考古都靠它。
- **计划评审是第三用法**:票面写好前交 Codex 做可行性评审(review-plan,
  read-only),NEEDS REVISION 的发现吸收进票面再开工(settle-channel 的
  四高发现即此道产出)。
- **基线记法照 tracker 规则**:写关系不写 SHA(the HEAD before this
  ticket's first implementation commit)。
