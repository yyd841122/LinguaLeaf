# 计划:LinguaLeaf 本地双击启动器(WSL2 + Windows)— 定稿

> 状态:**完成**(2026-10-31)。实机启动验收通过;同日追加「关闭网页即停」(T4 修订,见文末),WSL 侧全场景验证通过、全量测试 454 绿。剩余:桌面快捷方式(人工步骤②,可选)。
> 评审记录:`codex-review.md`(Codex verdict NEEDS REVISION → 三条硬协议补齐后定稿)。
> PRD/ARCHITECTURE.md 不存在、AGENTS.md 不动;本票即实现依据。

## 产品定位(已确认)

- **P1** 仅本机自用,不考虑分发 → 无打包需求
- **P2** 入口 = 现有书架页(BookshelfPage),不另做极简页
- **P3** 文件范围 = 现有 .epub/.md/.markdown/.pdf,不加 .txt(将来要做属导入管线新功能,与本票无关)

## MVP 定义

Windows 桌面双击 → `wsl.exe` 进入 WSL → 启动管理脚本 → 服务健康 → 打开 Windows 默认浏览器到书架页 → 页面内选文件 → 走现有 /api/books 导入。

## T1 交付形态 = (a) 快捷方式 + wsl.exe

- Windows 侧:桌面快捷方式/`.bat` 调 `wsl.exe`,**显式指定发行版与用户**,不依赖默认值
- WSL 侧:启动管理脚本(launch / stop);仓库用绝对路径引用;node 定位**不依赖非交互 shell 的 PATH**(显式解析 node 绝对路径,自检版本)
- 浏览器由 Windows 侧打开默认浏览器

## T2 运行模式 = prod + 手动构建 + 最低运行条件检查

- 跑 `npm start`(.output/server/main.js);**不自动 rebuild**
- 启动前最低运行条件检查:node 可用、node_modules 存在、`.output/server/main.js` 存在;缺 → 输出对应准备命令(`npm install` / `npm run build`)后退出,**不隐式安装/构建**
- 更新约定:改代码 = 停止 → `npm run build` → 启动;改 `.env` = 停止 → 启动;复用已跑实例时明示「正在使用现有实例(pid X)」,不代表源码/配置已刷新

## T3 选文件 = 页面内(零改动)

BookshelfPage.tsx 上传 UI 原样复用;服务端只收 multipart 字节,不做原生文件对话框。

## T4 生命周期协议(核心新增)

- **有效配置**:托管实例显式 `PORT=3000`(拒绝 PORT=0/动态端口)、`HOST=127.0.0.1`(自用最小暴露);浏览器固定入口 `http://127.0.0.1:3000/`;启动/复用/停止三处共享同一份有效配置(环境变量 > .env 的既有语义不变)。若实机验收发现 WSL localhost 转发不达 loopback 绑定,HOST 退回 0.0.0.0 并在验收矩阵记录
- **启动互斥(粒度=数据库身份)**:启动时在数据库旁原子创建锁文件(`.data/*.launch-lock`,O_EXCL);拿不到锁 = 同库已有实例 → 转复用流程;锁随进程退出清理,残留锁经归属核验后清理
- **托管记录**:运行目录写 state 文件(pid、仓库路径、端口、db 路径、启动时间);复用/停止前以 `/proc/<pid>/cwd` 比对验归属
- **复用**:探针通(`curl --noproxy '*'` http://127.0.0.1:3000/api/health)+ 归属核验通过 → 直接开浏览器
- **停止脚本**:验归属 → SIGTERM → 等退出(上限 15s,覆盖服务器 5s 优雅窗口)→ 超时明确报错,不自动升级 SIGKILL;**禁止按端口杀进程**
- **未知占用**:端口被非托管进程占 → 明确报错(提示怎么查),不自动杀、不悄悄换端口
- **常驻边界**:跨浏览器关闭、跨启动窗口关闭;WSL 关闭/Windows 重启后不自动拉起(再双击即恢复);无开机自启、无崩溃自愈
- **生命周期状态**:已停止 / 启动中 / 健康运行 / 受管异常(state 在但进程异常)/ 未知占用

## 启动失败契约

- 同时观察进程退出与探针;设总超时 + 单请求超时;失败输出可读错误 + 日志路径
- 浏览器打开失败 → 输出 URL,说明服务是否仍在运行
- 代理:探针请求绕过代理(本机环境事实,非 WSL2 通性)

## 首用前置(交付说明,非阻断降级)

- 一次性:`npm install`、`npm run build`、词典导入(`dict:import-ecdict` / `dict:import-ipa-dict`)
- 词典未导入 = 可用但音标行空(降级提示);DeepSeek key 缺 = 导入可用、翻译 409(非阻断)

## 构建顺序与验收矩阵

顺序:① WSL 侧启动管理脚本 + 归属/锁协议(终端可验)→ ② Windows 实机冷启/停止验收 → ③ 桌面快捷方式封装

验收项:
1. 冷启动双击 → 服务起 → 浏览器开到书架页
2. 并发双击(竞态)→ 收敛为单实例
3. 复用:服务已跑再双击 → 秒开浏览器,提示现有实例
4. 停止脚本:活动导入中停止 → SIGTERM 优雅退出,任务按服务器既有语义标记中断
5. 端口被非托管进程占 → 明确报错
6. WSL 侧与 Windows 侧可达性分别实测(localhost 转发;HOST 回退判定在此)
7. 残留锁/残留 state 经核验后可清理
8. 进程早退/探针超时 → 失败契约输出正确
9. 更新流:改代码后 停止→build→启动 生效;仅改 .env 停止→启动 生效
10. 验证用隔离数据库;实机步骤在 Windows 侧执行

## 人工步骤(勿跳)

1. WSL 侧脚本完成后:**Windows 实机冷启/停止验收**(浏览器可达性只能真机验,验收项 1/6)
2. 验收通过后:人工创建桌面快捷方式(指向 launch 入口)

## 实现记录(2026-10-31)

文件:
- `scripts/launcher/launcher-shared.mjs` — 固定配置(PORT=3000/HOST=127.0.0.1,动态端口拒绝)、数据库路径解析(镜像 `--env-file` 真实环境>.env>默认 的优先级)、健康探针(裸 http.get,代理不可见)、端口占用探测、归属判定(`/proc/<pid>/cwd`)
- `scripts/launcher/launch.mjs` — 运行条件检查(缺依赖/缺产物→给准备命令)→ 归属核验复用/清残 → 未知占用拒止 → O_EXCL 锁互斥(败者等胜者收敛)→ spawn(prod 入口,`--env-file-if-exists` 语义)→ 启动看护(早退/超时两分支:日志路径+尾部+记录清理+SIGTERM 直拉子进程)
- `scripts/launcher/stop.mjs` — 验归属 → SIGTERM → 等 15s → 超时保留记录;按端口杀禁止;幂等 exit 0
- `scripts/launcher/_node.sh` + `launch.sh` / `stop.sh` — 非交互 shell 的 node 显式解析(nvm source + 版本序兜底)
- `scripts/launcher/windows/lingualeaf-{launch,stop}.bat` — `wsl.exe` 显式发行版/用户;失败 pause;浏览器由 Windows 侧打开(F2)
- 记录文件含 nonce:清理仅限「自己的」或「核验为残留的」记录,绝不碰并发胜者的

WSL 侧验收证据(全部实际运行):
- 冷启动 exit=0、health 200(`curl --noproxy`);复用秒回「正在使用现有实例」
- 并发双击×2 → 一启一复用(pid 一致),双 exit=0,单实例核对通过
- 停止:SIGTERM 优雅退、端口释放、锁/状态清理;幂等停止 exit=0
- 残留自愈:死 pid 记录+遗留锁 → 清理后正常启动
- 未知占用:launch/stop 均明确报错不误杀(占位假进程由测试自行收尾)
- 失败契约:超时分支(挂起型故障,DICTIONARY_PATH 指向阻塞路径)与早退分支(EACCES 秒崩,日志尾含栈)均 exit=1、记录清理、端口交还;两类报错均含日志路径
- 隔离数据库:DATABASE_PATH 覆盖时锁/状态/日志随库路径迁移
- prettier/eslint/sh -n/node --check 全绿

未在本次运行覆盖(如实记录):
- 停止时正有活动导入:SIGTERM 路径已验;任务中断语义由服务器自身测试钉(server-task-lifecycle 票),可在实机验收顺带做
- 更新流(停止→build→启动)未整链跑:启停组件均已验,build 为标准 `npm run build`
- Windows 侧:双击 .bat、localhost 转发可达、浏览器打开 — 即人工步骤 ①

实机回归(2026-10-31,用户 Windows 双击):
- 暴露 F1 的真实形态:`wsl.exe` 非交互 PATH 命中 apt node v18.19.1,原 `_node.sh` 只解析路径未查版本 → 子进程 `bad option: --env-file-if-exists` 退出(code 9)。失败契约本身按设计工作(报错+日志尾+记录清理+bat pause)。
- 修复:`_node.sh` 全候选过版本门(≥22.12),候选序 = PATH 上的 node → nvm current → nvm 版本序(新→旧);失败时列出所见 node 及版本 + 修复指引(launch/stop 两包装同步)。
- 复现验证:系统 PATH 环境 → 跳过 v18 选 nvm v24.21.0,子进程 exe 核对 + health 200;全空环境(env -i 仅 HOME)→ nvm 兜底成功;仅旧 node → 列出 v18.19.1 + 修复指引 exit=1;PATH 连 coreutils 都无 → 127(报错本身需要 dirname,不现实场景)。
- 待用户重试双击;UNC 当前目录提示为良性(从 \\wsl.localhost 路径双击所致,建快捷方式设「起始位置」后消失)。
- 用户重试:**启动成功**,浏览器自动开到书架页。F2(Windows 侧可达)实测关闭。

## T4 修订:关闭网页即停(2026-10-31)

用户提出「关闭网页就停止,不需要手动」→ 反转原常驻边界。用户选定参数:**等任务做完再停** + **关闭后约 2 分钟**。

设计:
- **心跳**(apps/web/src/heartbeat.ts,挂于 main.tsx):每 10s `POST /api/heartbeat`,visibilitychange 回前台即报,pagehide 走 sendBeacon;fire-and-forget,服务已停不作为 UI 错误浮现。
- **服务端**:app.ts 内存记 `lastPageSeenAt`;`/api/health` 增补 `lastPageSeenAt` + `activeTasks`(task-lifecycle 新增 `activeTaskCount()`);restart 后时间戳为 null =「还没见过页面」。
- **看门狗**(scripts/launcher/watchdog.mjs,launch 就绪后 detached 拉起,接管子进程):轮询 health;`已见页 && now-lastPageSeenAt > 闲置上限 && activeTasks === 0` → SIGTERM → 清记录 → 退;从未见页超过首见预算(10 分钟)→ 停(浏览器没开成/秒关);服务进程自亡 → 清记录 → 退。闲置上限/首见预算可 env 调(LAUNCHER_IDLE_MS/LAUNCHER_FIRST_SEEN_MS,默认 120000/600000),仅为验证旋钮。
- 复用路径补拉看门狗(state.watcherPid 死了就重拉);stop.mjs 语义不变(即时手动停止,看门狗发现 pid 死后自行退出)。
- 常驻「秒开」随之消失:关页 2 分钟后再双击 = 几秒冷启动(这正是「关了就真关」的另一面,已向用户说明)。

验收(WSL 侧,全部实测):
- 空闲自停:心跳 2s/次 → 停发 → 闲置 9s(限 8s)停服,记录清、看门狗退
- 首见超时:全程无心跳 → 30s 预算到点自停(意外借旧产物验证:改服务端码未 build 时心跳字段不存在,恰好命中此路径——「改码必 停止→build→启动」的更新流顺带实测)
- **任务等待(核心)**:2000 句真实章节经 mock DeepSeek 翻译(~20s),心跳停止后闲置 6s 上限早已过,但 activeTasks=1 压住不停;02:27:29 任务完成后方以「pages idle 21s (limit 6s), no active tasks」停服
- 门禁:prettier/eslint/typecheck 绿;`npm test` 全量 **454 passed**(含 api/contract/web 三缝新增心跳钉:api 204+presence、contract 借 heartbeat.ts 走真 socket、web 4 例——立即/节拍/回前台/pagehide beacon/服务已停静默)

实现注记:
- 首版测试 C 用错章节(书被 `##` 分成两章,章 1 是空壳毫秒完成)→ 看门狗按规则正确停服;换章 2 后核心路径坐实。
- 测试书 21 已从真实库删除(blocks 挂 chapter_id,随 chapters 级联清);mock 已停。

## Code Review 与修复(2026-10-31,双轴并行评审)

Standards 轴(CODING_STANDARDS+GLOSSARY+Fowler 基线):0 硬违例,7 判断类——心跳静默吞错(规格明文 fire-and-forget,判不违例)、清理三份/SIGTERM 宽限三份/sh 失败块两份/固定 URL 两份(重复码)、env 旋钮(引文有误:plan.md 明载"仅为验证",降级)、"书页"措辞。Spec 轴(plan.md 为绑):T1–T4+修订 1:1 对应;3 实质发现。

修复批次(全落地,门禁+冒烟复绿):
- **C1 看门狗竞态根除**:spawnWatchdog 提前到初始 state 发布时(health 可通过之前 state 必含 watcherPid),复用补拉守卫只对真死看门狗生效;冒烟验证 state 立含存活 watcherPid、复用不重复拉起
- **A1+A2 双击入口可见性**:bat 成功路径 `timeout /t 5` 让启动/复用提示可读;`start` 后查 errorlevel,失败输出 URL+「仍在运行」+pause(规格"浏览器打开失败→输出URL"送达)
- **去重**:launcher-shared 增 `removeRecords()`+`gracefulStop(pid,waitMs)`,stop/watchdog/launch 三处收敛;sh 失败块去重经判**跳过**(包装脚本故意写笨,一行前缀不值跨文件耦合)
- **文案**:「书页」→「页面」(launch 提示+README)

评审方法记档:两代理引文逐条 grep 核对——Standards 第 5 条(旋钮无文档)与第 6 条(文案夸大)的论断未通过核对/判读,按核验结果修正后采信其余。
