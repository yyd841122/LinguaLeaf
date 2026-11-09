---
status: accepted
---

# 手机应用采用 Capacitor 纯端侧架构,以扩展阅读器为基座

「类微信读书」的个人英文阅读诉求(导入 EPUB/PDF、逐词音标、按章翻译、听书、笔记)落为**手机应用(GLOSSARY.md)**——LinguaLeaf 第四形态:Android 先行、APK 侧载自用、无账号体系。技术路线为 **Capacitor 壳 + WebView 跑现有 React 代码**,新起 `apps/mobile` 包;阅读基座 = 扩展阅读器刚完成整固拆分的 reader 模块与 store 层(`@lingualeaf/reading-model`、`@lingualeaf/import-core` 共享内核不动)。**纯端侧**:导入、离线词典(直接复用扩展烘料产物 `dictionary.json`)、持久化全部在手机本地;唯一网络缝 = 按需翻译直连 DeepSeek,key 运行时在设置页填写、存应用安全存储,不编译进 APK。ADR-0006 否决「扩展直连 DeepSeek」是因为扩展面向分发、key 无法按服务端秘密保护;自用 APK 运行时自填是不同情形,该否决不随之翻转——扩展本体仍守彻底无服务。听书 MVP 引擎 = 系统 TTS(原生插件同伺候「发音」与「听书」),云/离线神经 TTS 留后置增强票。

## Considered Options

- React Native / Flutter 重写 UI:逐词音标对齐排版与标注渲染是浏览器实证过的 React DOM 代码(扩展即活证),重写恰好发生在最贵处,换得的只有观感;单人自用不值
- web app 为基座做 serverless 化:`api.ts` 数据层(fetch→本地存储)整体翻新,PDF 还要从服务端 unpdf 路线换成 pdfjs-dist——两头都动;扩展基座只缺翻译缝(加一条网络缝)与听书(本来就要新做)
- 先抽共享内核、扩展与手机同时收敛:最干净,但先付一轮大重构才开工;短期分叉、漂移再收敛更划算
- PWA:免安装分发非诉求,且听书需要的前台服务/通知栏与文件缝是 PWA 弱项

## Consequences

- reader 代码在 `apps/extension` 与 `apps/mobile` 间暂时分叉;替换面已核最小——chrome.* 真实调用 = 四 store 的 `chrome.storage.local` + service-worker(扩展专属不搬),ReaderPage 仅以 chromeBackend 注入工厂引用、页面零直呼;mobile 侧换后端工厂即可;漂移了再立收敛票
- PDF 无句子块,听书按页面文本行序朗读,与 EPUB 听书存在已知体验差异
- 双端数据不做自动同步:全量备份/恢复 JSON 作为迁移与安全网(PC web 端加一条导出路由)
