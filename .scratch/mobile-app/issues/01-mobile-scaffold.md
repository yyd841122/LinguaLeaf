# 01 Capacitor 脚手架:apps/mobile 空壳真机可装
Status: ready-for-human(2026-11-09 实现进树,验收门真机项待人验,见 ## Comments)
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

## Comments

### 2026-11-09 实现收官(Lane A:Claude 直实现 + 内置双轴评审)

**选道记录**:Lane A。实现涉及沙箱做不到的事——npm 网络安装(Capacitor 全家桶)、
gradle/Android SDK 构建、JDK 21 安装(delegation-lanes:宿主网络、跨进程)。
实现者 ≠ 评审者:/implement 内置 code-review 双轴(Standards/Spec 并行 sub-agent)
已跑,发现与处置如下;Lane A 管线的 Codex 独立审核(read-only,对照票面逐条)留到
收官(人验后翻 done)前,与 caller 补跑 verify 同场。

**事实记录**(现场取数):

- 版本:npm 实装 @capacitor/{core,android,cli} **8.6.0**(领票时最新稳定);
  react 19.3.1 / vite 7.3.7 / @vitejs/plugin-react 5.2.0(版本线对齐扩展;
  plugin-react 6.x peer 要求 vite ^8,与票面 ~7.3.6 冲突,取扩展同款 ^5.0.4)
- 空壳:appId `dev.lingualeaf.app`,显示名 LinguaLeaf;BookshelfPage 占位路由,
  jsdom 测试先行(红→绿)
- 出包:`gradlew assembleDebug` BUILD SUCCESSFUL in 4m 29s,
  app-debug.apk 4,199,751 字节(label LinguaLeaf,minSdk 24/targetSdk 36)
- verify:首跑红(eslint 解析 cap sync 拷进 android 的 minified bundle 与
  build 中间物,2261 errors)→ eslint ignore `apps/mobile/android/**` →
  复跑 **EXIT=0**(68 文件,828 passed | 2 skipped,共 830)
- 工具链:Capacitor 8 的 capacitor-android 以 `JavaVersion.VERSION_21` 编译,
  系统 JDK 17 不够;本机装 Temurin 21.0.13(清华 Adoptium 镜像)至
  `~/development/jdk21`,经用户级 `~/.gradle/gradle.properties`
  (`org.gradle.java.home` + 代理 systemProp——gradle JVM 不读环境代理变量)
  接入;两件均机器本地,不进仓库,README 记了机制与本机示例

**评审发现与处置**(/implement 内置双轴,记档):

- Standards:无硬违规。判读两项已修:① Capacitor 模板残留
  ExampleInstrumentedTest/ExampleUnitTest 在 `com.getcapacitor.myapp` 包、前者
  钉死模板默认 appId(connectedAndroidTest 一跑必红)→ 删除;② README 机器本地
  路径改为「机制随仓库走、路径标本机示例」写法。判读一项记档不修:根三文件
  手列 workspace 链是仓内既有惯例(--workspaces 递归不采)
- Spec:无缺失、无范围蔓延、无错实现;verify EXIT=0 独立复核一致

**待收口(翻 done 前)**:

1. 【人验】手机开启开发者选项/USB 调试,`adb devices` 可见
2. 【人验】侧载
   `apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk`,
   确认启动到空书架页(LinguaLeaf 标题 + 「书架 / 还没有书,先导入一本吧。」)
3. caller 显式补跑根 `npm run verify`(退出码不等于 verify 门)
4. Lane A 管线的 Codex 独立审核(票面逐条 + 变异心证),随收官同场
