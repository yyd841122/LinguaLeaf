# 04 翻译缝:DeepSeek 客户端直连 + 设置页 key 管理
Status: done(2026-11-11 真机三项人验全过:译文行+开关、错 key 旗、断网旗,不崩)
Blocked by: 02(与 05 并行,双轨)

## 目标

按需翻译(ADR-0004:按章、显式触发)在手机端直连 DeepSeek:移植服务端翻译逻辑纯 TS 部分,设置页运行时管 key,不编译进 APK。**范围仅 EPUB**:句子块章承载按需翻译;PDF 坐标叠加无章节结构,译文行 Out of Scope(spec)。

## 范围

- 移植 apps/server/src/translate/deepseek.ts + batch.ts 的批次对齐/重试逻辑进 apps/mobile(纯 TS;不搬 Express 路由形状)
- 设置页:key / BASE_URL / MODEL 运行时填写;存储选型票内定(Capacitor 生态安全存储插件或等价;插件级选型不立 ADR)
- 章翻译触发 + 任务进度 UI:percent 可见步进、失败旗可读;异步落回走 settle-channel / 属主令牌不变量(CODING_STANDARDS 既有语义)
- 实现侧可用本地 OpenAI 兼容 mock 先验管线(BASE_URL 指 mock,零真实调用),再真机实测
- 扩展与 web 不动;翻译只进 mobile

## 验收门

- 根 verify EXIT=0
- mock 冒烟:percent 可见步进,零真实调用
- 真机【人验】:在线按章翻译出译文行、显示开关可隐;错 key 与断网各触发可读失败旗,不崩

## 用户操作项(人做)

- 设置页填入自己的 DeepSeek key
- 在线翻译一章 + 错 key + 断网三项验证

## Lane(领票时定,2026-11-10)

DeepSeek 直连需宿主网络 + 真机实测(Codex 沙箱禁网)→ **Lane A**;实现侧先
按票面走本地 OpenAI 兼容 mock 验管线(零真实调用)。

## Comments

### 2026-11-10 实现收官(Lane A)

**存储选型(票内定)**:key/BASE_URL/MODEL 走纯 IDB namespace record
(`apps/mobile/src/store/translate-settings-store.ts`)——票 02 的「纯 IDB、零
原生插件」同序;key 落在本机应用私有存储,与书/笔记同级,不加密、不编译进 APK
(ADR-0008)。插件级选型不立 ADR,按票面授权在票内定;若维护者要求密钥加密
(Capacitor Secure Storage 一类),换装面只在 store 工厂一处。

**移植偏差(两处,均注释在码)**:①超时用 AbortController+setTimeout 替代
server 的 AbortSignal.timeout——后者 Chromium 103+ 才有,老 Android WebView
会一个请求都发不出;abort 语义有单元钉子(119_999s 未断/120s 断)。②mock 端口
由测试预分配(mock 的横幅回显的是入参不是绑定端口,票外实证踩过)。

**双轴评审**(2026-11-10):Standards 无硬违规、glossary 合规;Spec 判「忠实且
基本完整,无阻塞」。已修:设置读取失败三处从静默变可读重试(浮层冻结态、
阅读页旗面、译文读取横幅原有);注释误归属修正(「已翻译锁定」是 web 客户端
语义,server 路由仅翻译中 409)。记不修:①SpeakFailureFlag/TranslateFailureFlag
组件与 CSS 孪生——跨票重构票 09 已评审面,批量清扫候选;②(docId, chapterIndex)
参数对——notes/progress/library 各 seam 同形,房规压过 baseline 嗅觉。

**test-env 备忘**:vitest jsdom 混合全局(undici fetch + jsdom AbortSignal 类
不相容),冒烟测试剥 signal 过检——真机单引擎无此问题,已在测试注释说明。

**勿忘(人验前)**:真机三项验证需先在设置页填真实 DeepSeek key(OpenAI 兼容
根地址,勿带 /anthropic 后缀——浮层有提示)。三项:①在线按章翻译出译文行、
译文开关可隐;②错 key → 可读失败旗不崩;③断网 → 同旗面不崩。完成后票翻 done。

### 2026-11-11 人验通过,翻 done

装包链路(apps/mobile/README 配方):assembleDebug BUILD SUCCESSFUL →
`adb install -r` Success(PCAM00 无线)→ 冷启 dump 确认新 dist 在包(书架出现
票 04 的「设置」入口)。用户真机回报三项全过:①在线按章翻译出译文行、译文开关
可隐;②错 key → 可读失败旗不崩;③断网 → 同旗面不崩。票面验收门全绿。
