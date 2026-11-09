# 01 Capacitor 脚手架:apps/mobile 空壳真机可装
Status: ready-for-agent(2026-11-09 立票;决策全锁定,见 ../spec.md 与 ADR-0008)
Blocked by: 无

## 目标

新起 `apps/mobile` npm workspace + Capacitor(Android)工程:Vite + React 构建喂 WebView,空壳 App(书架占位路由)出 debug APK,真机安装启动。

## 范围

- Capacitor 初始化:版本取领票时最新稳定版,以 npm 实际安装为准(票面不预写版本)
- 根 workspace 挂 apps/mobile;typecheck / test / build 挂进根脚本与 verify 链
- Vite + React 19 + @vitejs/plugin-react,版本线对齐扩展(react ^19.2.8 / vite ~7.3.6)
- 空壳:书架占位路由(形状预留,02 接真书架);显示名 LinguaLeaf,包名实现自定
- dev 流程:vite dev + Capacitor live reload;出包:gradle assembleDebug
- 引擎要求:Node >= 22.12(根 engines 既有);Android SDK / gradle 走 Capacitor 默认要求

## 验收门

- 根 `npm run verify` EXIT=0(评审基线 = 本票首个实现 commit 之前的 HEAD)
- debug APK 真机安装、启动到空书架页【人验】

## 用户操作项(人做)

- 手机开启开发者选项 / USB 调试,`adb devices` 可见
- 侧载 APK,确认启动
