# 02 storage 后端替换 + EPUB 链:断网真机读 EPUB 全链路
Status: ready-for-human(2026-11-09 实现收官:装机机检全绿 + verify EXIT=0(终树复跑)+ 双轴评审入 Comments;真机全链路与杀进程门待人验)
Blocked by: 01

## 目标

storage 后端经注入缝替换为 WebView 等价物,书架 + EPUB 阅读链路在真机打穿:断网可 导入 EPUB → 逐词音标 → 查词/生词/进度/书签/笔记,杀进程不丢。**tracer bullet 本票**:纯端侧的每一层(存储、导入、词典、UI)在此票首次贯通。

## 范围

- reader/ 与 store/ 模块搬入(15 + 10 文件清单见 spec 现状事实);扩展本体不动(D12)
- **替换面**:四 store 的 chrome.storage.local(library / namespace-record / notes / vocabulary)+ ReaderPage 的 chromeBackend 注入工厂(:153)→ WebView 等价后端(方案票内定:Capacitor Preferences 或纯 IDB,倾向少一个原生插件)
- idb-bytes-store / pdf-position-store / pdf-notes-store 零 chrome 直呼,本票随迁(03 启用)
- dictionary.json(14,943,187 字节)进 mobile 资产,复用烘料产物不改脚本;若必须改烘料,再生明写
- 文件导入入口:先验 `<input type=file>` 在 Android WebView 是否拉起系统选择器;不可用再换文件插件,替换记录进票
- 路由:BrowserRouter 在 Capacitor scheme 下改 HashRouter 或 base 调整,方案票内定
- PDF 站(ReaderPage 的 PDF host)随迁但**不启用**(03 打开);书架与 landing 形状保留

## 验收门

- 根 verify EXIT=0
- 真机【人验】:导入 EPUB → 逐词音标 + 点词查详情(含发音)+ 生词本四态 + 进度/书签/笔记;**飞行模式**重复全链路
- 持久性【人验】:杀进程重开,书/进度/生词/笔记仍在

## 用户操作项(人做)

- 准备一本真实 EPUB 传入手机
- 飞行模式与杀进程重开验证

## Comments

### 2026-11-09 实现收官(Lane A:Claude 直实现 + 内置双轴评审)

**选道记录**:Lane A。npm 网络安装(fake-indexeddb / pdfjs-dist / pdf-lib)、
无线 adb 装机、gradle 构建均为沙箱做不到的事(delegation-lanes:宿主网络、
跨进程);01 同款。实现者 ≠ 评审者:/implement 内置 code-review 双轴
(Standards/Spec 并行 sub-agent)已跑;Codex 独立审核留收官(人验后翻 done)
前,与 caller 补跑 verify 同场。评审基线 = 本票首个实现 commit 之前的 HEAD。

**票内决策**(票面留白三项,现场定):

1. **存储后端 = 纯 IDB**(票面倾向成立):`createIdbNamespaceStorage`
   (src/store/idb-namespace-storage.ts)——一库(lingualeaf-reader)一
   ObjectStore(namespaces),四个 namespace 记录(library / vocabulary /
   notes / pdf-notes)各占一键,pdf-positions 随迁同库;开合纪律镜像
   `createIndexedDbBytesBackend`(逐事务开合、onversionchange 关闭、
   factory 可注入)。不用 Capacitor Preferences:书是多 MB JSON,
   SharedPreferences 装不下;零新增原生插件。
2. **路由零改动**:扩展 reader 入口本无 react-router(router 只在
   apps/web);mobile main.tsx / App.tsx 直接挂 ReaderPage,无 HashRouter
   需求。
3. **reader/main.tsx 不搬**(15 文件清单偏差一,mobile 单一入口避免双
   entry,App.tsx 即组合根);**dict/offline-dictionary.ts 清单外随迁**
   (reader 三处引用的依赖面)。
4. **PDF host 代码随迁、行为不变**:`accept=".epub,.pdf"` 与 acceptPdf
   分支原样——「不启用」指 02 门只验 EPUB,03 打开;无开关可关。
5. **landing 文案照搬未改**(「浏览器未授予持久存储」hint、aria-label
   「扩展阅读页」等浏览器措辞):landing 形状保留、上游逐字副本同步便宜;
   文案手机化列为 06 收口候选。

**事实记录**(现场取数):

- 面积:19 src 逐字副本(reader 13 + store 5 + dict 1)+ 六文件补丁
  (namespace-record storage 必填、library/vocabulary 工厂参数化、
  notes/pdf-notes 去 chrome 工厂、ReaderPage 注入工厂换 IDB)+ 12 test
  逐字副本 + 3 test 补丁/新写。`grep chrome apps/mobile/src` 代码引用
  零命中(仅注释提 parity)——四 store + pdf-positions 全走注入缝。
- dictionary.json **14,943,187 字节** cmp 同一进 apps/mobile/public/
  (烘料产物复用,脚本零改动;曾遭 lint-staged rewrap,见评审处置①)。
- mobile 套件 17 文件 **201 passed | 1 skipped**;根 `npm run verify`
  **EXIT=0**(84 文件,1028 passed | 3 skipped),fix 后终树复跑同 EXIT=0。
- APK **10,204,491 字节**(空壳 4,199,751 → 词典 + reader 进包);
  gradle assembleDebug BUILD SUCCESSFUL。
- **装机机检**(无线 adb,PCAM00/ColorOS,`-s 192.168.0.2:38193`):
  `adb install -r` Success;冷启 COLD **TotalTime 1106ms**;landing dump
  文案齐(LinguaLeaf / 选择 EPUB 或 PDF 文件 / 标注在浏览器本地完成 /
  PDF 书架空态),最近文档空库不渲染正确;两个 IDB 库(lingualeaf-reader
  与 lingualeaf-pdf-bytes)随 landing 读路径在真机打开并解析无错;
  logcat **0 FATAL、0 E/chromium、0 Capacitor error**。
- persistence = **denied**(WebView 启发式不授予 persist();数据持久性
  不依赖该授权——IDB 事务照常落盘;杀进程不丢由【人验】裁决)。
- **`<input type=file>` 拉起系统选择器实证**:Capacitor 桥的
  onShowFileChooser 工作正常,选择器按 .epub/.pdf 过滤(JSON 文件灰置)。
  但 OPPO DocumentsUI 的**列表行对合成 tap 一律不响应**(drawer、筛选
  chips、搜索可点;行 tap/微动 swipe/长按全部 handled=true 无效果,疑
  TOOL_TYPE_UNKNOWN 过滤)——选择器内选文件留【人验】,真人手指无此问题。
- 机检用测试书 mobile-smoke-book.epub(仓库 buildEpub 确定性拼装)已推
  /sdcard/Download/,人验可直接用;官方票面仍建议再备一本真实 EPUB。

**评审发现与处置**(/implement 内置双轴,记档):

- **Standards 硬违规一(已修,fix commit c54100c)**:lint-staged
  `{"*": prettier --write}` 把 staged 的 dictionary.json 重排成 pretty
  (14,943,187 → 18,310,286 字节),破坏「生成物字节同一」门 → 两份资产
  (extension / mobile)进 .prettierignore + mobile 副本还原 minified
  (cmp 同一)。extension 副本的同类潜在 trap 一并钉住(任何 future
  触碰都会被重排)。
- **Standards 判读三(记档不修)**:① idb 开合事务模式在
  idb-namespace-storage 与 idb-bytes-store 各一份——跨 fork 边界局部
  去重会让逐字副本漂移,同步成本 > 40 行模式重复,收敛留上游;② 六注入缝
  props 数据团——上游 ReaderPage 既有形状,「hosts wiring」标准容忍;
  ③ App.tsx 纯透传 middle-man——刻意保留的组合根(票史注释在文件内)。
- **Spec**:无缺失、无范围蔓延;替换面接线、零 chrome、测试随迁面
  (15/16,copy checkManifestPermissions 正确排除)、适配器契约新测均
  两轴独立证实。

**待收口(翻 done 前)**:

1. 【人验】导入 EPUB → 逐词音标 + 点词查详情(含发音)+ 生词本四态 +
   进度/书签/笔记;**飞行模式**重复全链路(书在 /sdcard/Download/,或
   自备真实 EPUB)
2. 【人验】杀进程重开:书/进度/生词/笔记仍在
3. caller 显式补跑根 `npm run verify`(退出码不等于 verify 门)
4. Lane A 管线的 Codex 独立审核(票面逐条 + 变异心证),随收官同场
5. 若点词发音(speechSynthesis)真机不可靠 → 原生 TTS 插件回填,记录
   进票(spec 既有预案);若选择器真机也可疑 → 换文件插件,替换记录进票

### 2026-11-09 人验确认(caller 会话内问答记档)

- **EPUB 链路人验:通过**——维护者确认(会话内「确认epub 通过」)
- **飞行模式断网全链路:已验证**(维护者勾选)
- **杀进程重开资产仍在:已验证**(维护者勾选:书/进度/生词/笔记都在)
- **点词发音:不通过**——按钮可点、不出声(speechSynthesis 在 Android
  WebView 静默,spec 既有预案触发)→ 存根票
  [09-mobile-pronunciation-native-tts](09-mobile-pronunciation-native-tts.md)
  承接原生 TTS 回填(needs-triage:提前立 vs 并入 07 同插件,triage 拍板)
- 验收门「点词查详情(含发音)」字面未全绿,02 暂不翻 done,等发音缺口
  处置拍板(按预案路由 09 后翻 done,或等 09 落地)
- caller 显式补跑根 `npm run verify`:**EXIT=0**(84 文件,1028 passed |
  3 skipped)

### 2026-11-09 Codex 独立审核:usage 限额触顶,改期补跑

首跑失败(codex-runner EXIT=1,非 stalled):**usage limit hit,22:02 PM
重置**。按纪律失败不重试。jobId `review-plan-mw994ujb-wcwqsz`,threadId
`01a1c055-61e5-7603-917b-629e3d03e036`(入档;prompt 已在该 thread 内,
`/cc-suite:continue 01a1c055-61e5-7603-917b-629e3d03e036` 或 resume 补跑,
审核契约全文见该次调用)。待收口第 4 条照旧,改到限额恢复后执行。
双轴内置评审(Standards/Spec sub-agent)已先行跑过并记档,本条为独立模型
终审,不因 fallback 缺位。
