# @lingualeaf/mobile

手机应用（GLOSSARY：手机应用）—— Capacitor 壳 + WebView 跑 React 代码（ADR-0008）。
当前为空壳（票 01）：书架占位路由，出 debug APK 真机可装。

## 工具链要求

- Node >= 22.12（根 engines 既有）
- JDK 21：Capacitor 8 的 `capacitor-android` 库以 `JavaVersion.VERSION_21` 编译，
  系统 JDK 17 编不过。装一份 JDK 21 后，在**用户级** `~/.gradle/gradle.properties`
  以 `org.gradle.java.home=<JDK21 路径>` 指给 Gradle（机器本地文件，不进仓库；
  代理 systemProp 也在那。本机示例：解压版 Temurin 21 在 `~/development/jdk21`）。
- Android SDK：compileSdk 36 / build-tools 36（`ANDROID_HOME` 指向 sdk 根）。

## 常用命令（都在本目录）

```sh
npm run dev            # vite dev server（5173）
npm run build          # vite build → dist/
npm run cap:sync       # dist → android 工程（Capacitor copy+update）
npm test               # vitest（jsdom 缝，根 vitest projects 挂 mobile）
```

## dev 流程（live reload）

```sh
npm run dev                                              # 1. vite dev 起来
adb reverse tcp:5173 tcp:5173                            # 2. 手机 localhost → 本机
CAP_DEV_SERVER_URL=http://localhost:5173 npm run cap:sync # 3. 注入 dev server 地址
cd android && ./gradlew assembleDebug                     # 4. 出包（照常安装）
```

注入后 WebView 加载 `http://localhost:5173`，改代码即时热更；删掉注入
（重新不带变量 `npm run cap:sync`）即回到加载 APK 内置 dist。

## 出包（debug APK）

```sh
npm run build && npm run cap:sync
cd android && ./gradlew assembleDebug
# 产物：android/app/build/outputs/apk/debug/app-debug.apk
```

安装启动属【人验】项（见 `.scratch/mobile-app/issues/01-mobile-scaffold.md`）。

## 测试缝（spec 约定）

1. 纯逻辑 → vitest 既有缝（02 起随搬入模块增长）
2. React 组件 → jsdom 既有缝（本目录 test/，先例 = extension readerPage 一脉）
3. Capacitor 原生缝 → 桩注入 + 真机【人验】，不进自动化
