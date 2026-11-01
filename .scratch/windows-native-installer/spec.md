# windows-native-installer:Windows 原生一键安装包(Inno Setup 向导)

Status: ready-for-agent

来源:维护者要在全新 Windows(无 Node/Python/任何工具)上使用本项目;三形态
拍板选「Inno Setup .exe 向导」(2026-11-01)。宿主机探测:无 winget、无 Node、
无 Inno Setup;仓库公有(匿名 zip 可下)。

## 问题

新 Windows 机器从零用到本项目,需手工装 Node、git、拷数据、npm install、
build——非开发者不可重复。要一个安装向导 exe:双击→下一步→完成→桌面双击
即用。

## 已由代码定案(不再决策)

1. **.output 不自包含**(736K,无 .node/无 node_modules):生产运行时 =
   .output + 生产依赖(express、better-sqlite3 等)+ Node 本体。
2. **better-sqlite3 原生模块按平台安装**:打包机是 WSL Linux,装不出
   win-x64 预编译——目标机必须自己跑一次 `npm install`(便携 npm 可离线
   驱动,仅联网拉包)。
3. **Node 便携 zip 自带 npm**(node.exe + npm.cmd),单装 node.exe 则无 npm。
4. **Inno Setup 只有 Windows 编译器**(ISCC.exe):打包与编译在 Windows 宿主
   侧执行(WSL 经 /mnt/c 调 cmd.exe),文件下载走 WSL curl 到 /mnt/c。

## 决策(维护者拍板 + 实现约定)

1. **免管理员**:PrivilegesRequired=lowest,默认目录
   %LOCALAPPDATA%\Programs\LinguaLeaf;桌面 + 开始菜单快捷方式(当前用户)。
2. **载荷 = 源码快照(git archive HEAD,天然排除 .env/.data/node_modules)+
   预构建 .output(打包时 npm run build 产出,平台无关)+ 便携 Node v24
   win-x64 运行时(runtime\)**。
3. **首启补依赖**:启动 bat 检测 node_modules 缺失 →
   `runtime\npm.cmd install --omit=dev`(需联网一次)→ 用既有 .output 启动,
   目标机永不执行 build。已装过则直接启动。
4. **数据不进包**:.env 与 .data 手动拷入安装目录(完成页 + 随包
   README-install.txt 写明来源路径与步骤);升级重装同目录,数据天然保留。
5. **停止 = 启动时记录 PID 到 .data\server.pid,停止 bat taskkill 该 PID**
   (循 WSL 侧 stop 纪律:永不按端口杀)。
6. **打包管线入仓**:scripts/launcher/windows-native/build-installer.mjs
   (WSL 侧:git archive → 下载 node zip → 组 payload → 生成 .iss → 调
   ISCC)→ dist/LinguaLeaf-setup-<version>.exe;版本取根 package.json。

## 验收

1. 打包脚本在本机跑通,产出 dist/LinguaLeaf-setup-*.exe(预计 25-40MB)。
2. 静默安装测试:`/VERYSILENT /DIR=%TEMP%\LinguaLeafTest` 经 cmd.exe 执行,
   文件树完整(runtime\node.exe -v 有版本输出、启动/停止 bat、.output、
   源码、快捷方式逻辑)。
3. 首启冒烟(真 npm install --omit=dev,联网):测试目录内启动 bat 跑通,
   /api/health 返回 ok,停止 bat 停净。
4. 仓库 `npm run verify` 全绿(本票仅新增文件,零改动既有代码)。

## Gate

- 验收 1-3 经 cmd.exe 实测(打包机即 Windows 宿主,首启冒烟在 %TEMP%
  隔离目录,不碰真实数据)。
- Inno Setup 安装到宿主(官方 innosetup 静默装)属工具链引入,票面已记;
  UAC 弹窗由维护者点允许。
- Codex 沙箱(纯 Linux,无 cmd.exe/winget)无法实现/验证本票 Windows 侧,
  本票由编排会话直接实现,评审仍走双轴(基线 = 本票首个实现 commit 之前的
  HEAD)。
