# mobile-app:LinguaLeaf 手机应用(Android)
Status: ready-for-agent(2026-11-09 /to-spec 成文;/to-tickets 定稿八票双轨,见 issues/)

需求澄清(/grill-with-docs,2026-11-09:设计树三轮、十二题拍板)→ /to-spec 成文 → /to-tickets 定稿(八票双轨)。架构决策本体 = **ADR-0008**(Capacitor 纯端侧、扩展阅读器为基座)。GLOSSARY 术语沿用:手机应用、听书(与发音严格分开)、生词本、标注、句子块、按需翻译、属主令牌。

## Problem Statement

现有两个形态都在桌面侧:PC web 端要开电脑,浏览器扩展要开浏览器——读英文书离不开书桌。学习者想要的是微信读书式的手机体验:通勤路上、熄屏睡前,随手打开就有自己的书;导入自己的 EPUB/PDF,逐词音标带着读、看不懂的句子按章翻译、单词点一下就有音标释义和读音、顺手记笔记,断网也一切照旧。这些能力仓库里已全部存在(扩展侧的纯端侧阅读链路已实证),唯独没有装进口袋的形态。

## Solution

自用侧载的 Android 应用(Capacitor 壳 + WebView 跑现有 React 代码):把扩展阅读器的纯端侧全链路(双格式导入、离线词典、生词本四态、进度/书签/笔记)搬进新包,加一条 DeepSeek 按需翻译网络缝(key 运行时自填、不进安装包)和全新听书(系统 TTS 连续朗读)。分两批交付:第一批日常可用(装上手机就能导入读书),第二批听书(含锁屏后台播)。

## User Stories

1. 作为一名学习者,我要把 LinguaLeaf 装成 Android 应用侧载使用,这样无需账号和应用商店就有自己的阅读工具。
2. 我要导入本地 EPUB,这样书在手机本地解析成可标注的书,不依赖任何服务器。
3. 我要导入文本层完好的 PDF,这样主流 PDF 也能享受坐标叠加的音标标注(扫描件除外)。
4. 我要重开一本书自动回到上次读到的位置,这样随手续读不用找页。
5. 我要阅读时每个词正下方有音标行,这样不切词典也能顺读。
6. 我要按类显隐音标行和译文行,这样在干净原文与全标注之间随心切换。
7. 我要对某一章显式触发按需翻译,这样联网一次生成译文行,之后离线可读。
8. 我要点击生词弹出音标和中文释义,这样即点即查不打断阅读。
9. 我要在查词弹窗里听单词发音,这样能跟读学音。
10. 我要生词按词元记四态(学习中/已掌握/已忽略),这样跨书管理词汇资产。
11. 我要在当前位置打书签并从目录跳回,这样重要位置随取随用。
12. 我要在句子上记四型笔记(进度/感受/思路/疑问)和整书笔记,这样想法跟着位置走。
13. 我要跨书回看笔记的复习页,这样定期回顾所学所想。
14. 我要听书模式连续朗读书籍正文,这样通勤熄屏也能「读」书。
15. 我要听书的暂停/调速/上下句跳转,这样节奏跟着我走。
16. 我要锁屏后台连播和通知栏控制,这样听书像播客一样用。
17. 我要回到应用时看到当前朗读句高亮,这样视听同步不迷路。
18. 我要全量备份导出与恢复导入,这样换机、误删都不丢学习者资产。
19. 我要从 PC web 端导出备份并导入手机,这样既有书、生词、笔记、进度一次搬家。
20. 我要断网时导入、阅读、查词、笔记、听书(本地引擎)一切照旧,这样无网环境完全可用。
21. 我要系统切深色时应用跟随,这样夜读不刺眼。
22. 我要在 key 填错或断网时看到可读的失败旗,这样问题自己能诊断。
23. 我要删除书架上的书而生词本资产保留,这样书走词留。
24. 我要在设置页运行时填 API key 且存安全存储,这样密钥永不进安装包。

## Implementation Decisions

遵循 to-spec 模板,本节不写文件路径;事实级细节(文件清单、字节量、行号锚)按本仓 tracker 惯例钉在「Further Notes · 现状事实」。

- 架构:ADR-0008 全文有效——Capacitor 最新稳定版(领票时取 npm 实际为准),扩展本体不动
- 决策记录(2026-11-09 全数拍板):

| # | 决策 | 结论 |
|---|------|------|
| D1 | 发布范围 | 自用侧载 APK,无账号 |
| D2 | 平台 | Android 先行,iOS 后议 |
| D3 | 运行形态 | 纯端侧,唯一网络缝 = DeepSeek 按需翻译 |
| D4 | 对齐范围 | 只做阅读体验,无书城/社交 |
| D5 | MVP | 全量平移 + 听书,分两批 |
| D6 | 听书 | 连续朗读,进度跟随;与发音分开 |
| D7 | 听书引擎 | MVP 系统 TTS;云/离线神经留后置票 |
| D8 | 双端数据 | 手动备份/恢复 JSON,无自动同步 |
| D9 | 后台播 | 锁屏续播,前台服务 + 通知栏 |
| D10 | 翻页 | 上下滚动(现状);左右翻页未立案 |
| D11 | 技术路线 | Capacitor;RN/Flutter 否决 |
| D12 | 基座 | 扩展阅读器 → 新包,扩展本体不动 |

- 模块:新 apps/mobile 包承载 reader/store 搬移面;共享内核(reading-model / import-core)不动
- 持久化:storage 后端经既有注入缝替换为 WebView 等价物(Capacitor Preferences 或纯 IDB,票内定),倾向少一个原生插件
- 翻译缝:服务端翻译逻辑的纯 TS 部分客户端化,直连 DeepSeek;按需翻译语义(ADR-0004:按章、显式触发)不变;**范围仅 EPUB**(PDF 无章节结构,见 Out of Scope);异步落回沿用属主令牌/落回裁决不变量
- 备份:版本化 JSON;必含生词本/笔记/进度/书签,书原文件可选;导入冲突粒度实现时定并记录;PC 侧仅加一条全量导出路由
- 听书:系统 TTS 原生插件,同插件伺候发音与听书;句子块序列连读,进度跟随;PDF 按页面文本行序(已知差异,ADR-0008)
- 交互基线:上下滚动(D10);深色跟随系统;显示开关语义沿用 GLOSSARY

## Testing Decisions

- 好测试只测外部行为:搬入模块随迁既有测试;新增测试针对 storage 后端适配器的读写契约、翻译批次的对齐输出、UI 的渲染与交互,不测内部实现细节
- **测试缝(2026-11-09 提案成文,三层,全部优先复用既有缝):**
  1. 纯逻辑(导入管线、翻译批次对齐、storage 后端适配器)→ vitest 既有缝;先例 = 扩展 reader 测试与 import-core 测试
  2. React 组件(阅读站 UI)→ jsdom 既有缝;先例 = 扩展 readerPage 测试一脉
  3. Capacitor 原生缝(TTS/文件选择/前台服务)→ vitest 不可达,**桩注入 + 真机【人验】**;桩纪律先例 = 扩展冒烟(chrome stub 掩盖面已知名);真机操作用 device-check 点按/dump
- 新缝最少化:唯一新缝 = Capacitor 插件层,一律以桩注入进 vitest;真机行为只进【人验】门,不进自动化
- 门纪律:验收门看退出码(根 verify EXIT=0),评审基线 = 本票首个实现 commit 之前的 HEAD;真机项一律【人验】入票;票面测试计数以跑套件输出为准

## Out of Scope

- 书城、社交、会员、排行榜(D4)
- iOS(D2 后议;Capacitor 同代码可包,单独立票)
- 左右翻页(D10 未立案)、自动同步(D8 否决)
- 云 TTS / 离线神经 TTS(D7 后置增强票)
- 扫描件 PDF(既有导入边界)
- **PDF 译文行**:按需翻译仅覆盖 EPUB(句子块章);PDF 坐标叠加无章节结构(2026-11-09 /to-tickets 澄清)
- web 端功能演进(唯一例外:备份全量导出路由一处小改);扩展本体任何行为变更(D12)

## Further Notes

### 现状事实(2026-11-09 编排侧现场取数,HEAD=64e8639)

- **扩展 reader 模块**(apps/extension/src/reader/,15 文件):EpubChapter.tsx、EpubReader.tsx、NoteEditor.tsx、PdfReader.tsx、PdfShelf.tsx、ReaderLanding.tsx、ReaderPage.tsx、WordLookupPopup.tsx、import-book.ts、main.tsx、pdf-lines.ts、pdf.ts、reader.css、usePdfOpen.ts、usePdfShelf.ts
- **store 层**(apps/extension/src/store/,10 文件):book-fingerprint、idb-bytes-store、library-store、namespace-record、notes-store、pdf-fingerprint、pdf-notes-store、pdf-position-store、storage-persistence、vocabulary-store
- **chrome.\* 直呼面**(grep 现场):真实调用 = 四 store 的 chrome.storage.local(library / namespace-record / notes / vocabulary)+ service-worker.ts(tabs/windows/runtime/contextMenus/action,扩展专属不搬);reader/ReaderPage.tsx 仅注入缝引用(:15 chromeBackend 参数)与注释,页面零直呼。**替换面 = 四 store 的 storage 后端 + 注入工厂**
- **存储后端注入缝已存在**:ReaderPage.tsx:153 `injectedStore ?? createVocabularyStore(offline, chromeBackend())`——mobile 侧换非 chrome 后端工厂即可,页面不动
- **离线词典**:apps/extension/public/dictionary.json = 14,943,187 字节;烘料脚本 apps/extension/scripts/bake-dictionary.ts(npm run bake:dictionary);复用产物不改脚本,若必须改,再生明写
- **发音**:packages/reading-model/src/speak.ts:6 `speakWord`(window.speechSynthesis);WebView 可靠性真机实测后定,不可靠则原生 TTS 插件回填
- **翻译缺席是设计而非缺口**:apps/extension/src 内 deepseek/translate 零命中(ADR-0006 有意排除)
- **依赖线**:react ^19.2.8、pdfjs-dist ^4.10.38、vite ~7.3.6(apps/extension/package.json)
- **PC 侧备份落点**:apps/web/src/api.ts 为单文件薄 fetch 封装;导出路由落 books-router 旁

### 批次与票索引(2026-11-09 /to-tickets 定稿,八票双轨)

- **第一批(能日常装上手机用)**:01 → 02 → {03 ∥ 04 ∥ 05 三线并行} → 06
- **第二批**:07 → 08

| 票 | 标题 | Blocked by |
|----|------|-----------|
| 01 | Capacitor 脚手架:空壳真机可装 | — |
| 02 | storage 后端替换 + EPUB 链 | 01 |
| 03 | PDF 链 | 02 |
| 04 | 翻译缝:DeepSeek 客户端直连 + 设置页 | 02(与 05 并行) |
| 05 | 备份/恢复:全量 JSON 双端手动互通 | 02(与 04 并行) |
| 06 | 第一批收口:触控/安全区/深色跟随(exit gate) | 04 + 05 |
| 07 | 听书 MVP:系统 TTS 连续朗读 EPUB | 06 |
| 08 | 听书后台:前台服务 + 通知栏 | 07 |

### 领票与门

- Lane 按 docs/agents/delegation-lanes.md 领票时定;真机项一律标【人验】
- 未立案留后:左右翻页、云/离线神经 TTS、iOS、自动同步——浮现再立 needs-triage 存根票
