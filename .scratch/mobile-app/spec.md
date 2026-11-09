# mobile-app:LinguaLeaf 手机应用(Android)

需求澄清产出(2026-11-09,/grill-with-docs:设计树三轮、侦察代理现场摸底,维护者逐题拍板,共识确认)。架构决策见 **ADR-0008**(Capacitor 纯端侧、扩展阅读器为基座)。GLOSSARY 已立「听书 (Read-aloud)」「手机应用 (Mobile App)」;听书与「发音」严格分开。

## 决策记录(2026-11-09 全数拍板)

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
| D12 | 基座 | 扩展阅读器 → apps/mobile,扩展本体不动 |

## 批次

- **第一批(能日常装上手机用)**:01 → 02 → 03 → 04 → 05
- **第二批**:06 → 07

## 现状事实(2026-11-09 编排侧现场取数,HEAD=64e8639)

- **扩展 reader 模块**(apps/extension/src/reader/,15 文件):EpubChapter.tsx、EpubReader.tsx、NoteEditor.tsx、PdfReader.tsx、PdfShelf.tsx、ReaderLanding.tsx、ReaderPage.tsx、WordLookupPopup.tsx、import-book.ts、main.tsx、pdf-lines.ts、pdf.ts、reader.css、usePdfOpen.ts、usePdfShelf.ts
- **store 层**(apps/extension/src/store/,10 文件):book-fingerprint、idb-bytes-store、library-store、namespace-record、notes-store、pdf-fingerprint、pdf-notes-store、pdf-position-store、storage-persistence、vocabulary-store
- **chrome.\* 直呼面**(grep 现场):真实调用 = 四 store 的 chrome.storage.local(library / namespace-record / notes / vocabulary)+ service-worker.ts(tabs/windows/runtime/contextMenus/action,扩展专属不搬);reader/ReaderPage.tsx 仅注入缝引用(:15 chromeBackend 参数)与注释,页面零直呼。**替换面 = 四 store 的 storage 后端 + 注入工厂**
- **存储后端注入缝已存在**:ReaderPage.tsx:153 `injectedStore ?? createVocabularyStore(offline, chromeBackend())`——mobile 侧换非 chrome 后端工厂即可,页面不动
- **离线词典**:apps/extension/public/dictionary.json = 14,943,187 字节;烘料脚本 apps/extension/scripts/bake-dictionary.ts(npm run bake:dictionary);mobile 复用产物不改脚本,若必须改,再生明写
- **发音**:packages/reading-model/src/speak.ts:6 `speakWord`(window.speechSynthesis);WebView 可靠性真机实测后定,不可靠则原生 TTS 插件回填
- **翻译缺席是设计而非缺口**:apps/extension/src 内 deepseek/translate 零命中(ADR-0006 有意排除)
- **依赖线**:react ^19.2.8、pdfjs-dist ^4.10.38、vite ~7.3.6(apps/extension/package.json)
- **PC 侧备份落点**:apps/web/src/api.ts 为单文件薄 fetch 封装;导出路由落 books-router 旁

## 票索引

| 票 | 标题 | Blocked by |
|----|------|-----------|
| 01 | Capacitor 脚手架:空壳真机可装 | — |
| 02 | 阅读器搬移:离线全链路真机可用 | 01 |
| 03 | 翻译缝:DeepSeek 客户端直连 + 设置页 | 02 |
| 04 | 备份/恢复:全量 JSON 双端手动互通 | 03 |
| 05 | 第一批收口:触控/安全区/深色跟随 | 04 |
| 06 | 听书 MVP:系统 TTS 连续朗读 EPUB | 05 |
| 07 | 听书后台:前台服务 + 通知栏 | 06 |

## 领票与门

- Lane 按 docs/agents/delegation-lanes.md 领票时定;真机项一律标【人验】
- 验收门看退出码(根 verify EXIT=0),评审基线 = 本票首个实现 commit 之前的 HEAD
- 门禁文本只述关系不预写值;票面测试计数以跑套件输出为准
- 未立案留后:左右翻页、云/离线神经 TTS、iOS、自动同步——浮现再立 needs-triage 存根票
