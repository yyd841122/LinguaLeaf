# 02 storage 后端替换 + EPUB 链:断网真机读 EPUB 全链路
Status: done(2026-11-09 收官:人验四门过三,发音缺口按 spec 预案路由存根 09,维护者拍板 A 翻 done;Codex 终审 usage 触顶改期补跑,如有实项按 follow-up 处置,见 ## Comments)
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

### 2026-11-09 收官翻 done(维护者拍板 A)

发音缺口处置拍板:**A = 按预案翻 done + 09 提前立票实现**(三选项 A/B/C
中取 A;B=并入 07、C=等 09 落地)。02 的纯端侧 EPUB 链路本体(导入/音标/
查词/生词四态/进度/书签/笔记 + 飞行模式 + 杀进程持久)已全验,验收门唯一
未绿项「点词查详情(含发音)」路由存根
[09-mobile-pronunciation-native-tts](09-mobile-pronunciation-native-tts.md)
(已立 ready-for-agent,排 06 收口前实现,07 听书复用同插件)。
Codex 独立终审仍欠(usage 触顶,22:02 重置后补跑,threadId 已档):
**done 不遮审核欠账**——补跑若出实项,按 follow-up 修笔处置并补跑 verify。

### 2026-11-09 Codex 独立终审记档(NEEDS REVISION:书签失实为首)

补跑完成:jobId `review-plan-mw9c1wh8-k2ijo2`,threadId
`01a1c055-61e5-7603-917b-629e3d03e036`(resume 同 thread),gpt-6.1-sol/high,
read-only。审计基线 a015f31...55a1688。全报告在 thread 内,要点与处置:

**票面逐条 18 项:15 PASS + 3 CONCERN + 1 FAIL**。替换面接线、零 chrome
(5 处注释 0 代码)、字典字节身份(cmp=0)、装机与人验记录、09 路由忠实度
等全 PASS;变异 a/b 有 catcher(mobile typecheck / 适配器契约测试)。

**FAIL(14 书签)——核实属实,照单全收**:书签能力在扩展阅读器中**从未
存在**(书签是 apps/web 的 reading-bookmarks 特性);spec Solution 段把
「进度/书签/笔记」误写成扩展既有能力,to-tickets 转录进本票门,收官记录
随之失实。处置:① spec.md:12 事实句已勘误(本票 Comments 留档);② 新票
10-mobile-bookmarks 承接(needs-triage,时点/形状待拍板);③ **收官声明
修正**:下段「纯端侧 EPUB 链路本体(…进度/书签/笔记…)已全验」中「书签」
二字撤销——已验 = 进度 + 笔记(发音路由 09,书签路由 10)。

**mutation c(字典字节门)NO CATCHER → follow-up 修笔(done 记录预授权)**:
新增 apps/mobile/test/dictionaryAsset.test.ts——mobile 副本与 extension
烘料逐字节同一 + 两路径都在 .prettierignore,双断言套件(jsdom 的
import.meta.url 陷阱按记忆配方 cwd 锚绕开),mobile 套件绿。从此删 ignore
条目或 rewrap 落盘都会红。

**事实记录修正(审计 事实复核 1/2)**:src 实际 = **18 逐字副本**
(reader 13 + store 4 + dict 1)**+ 7 修改**(namespace-record / library /
vocabulary / notes / pdf-notes / pdf-position / ReaderPage)+ 1 新增
(idb-namespace-storage);pdf-position 的必填补丁此前漏计。test 实际 =
**13 逐字 + 2 修改**(libraryStore chrome-stub 段重写 / readerPage 一行
注释)+ 1 新增(适配器),另有 App.test 重写与 setup.ts 加 crypto stub。
字节量、APK 大小、测试计数(201|1 / 1028|3)审计复核吻合。

**两项 CONCERN 记档**:PDF「不启用」——决策 4 原文即「02 门只验 EPUB,
03 打开」,语义已record在案,不改历史文本;verify 独立复证——审计按
read-only 契约只复核 typecheck/lint,caller 门照例另行补跑(EXIT 见下条
补记)。

**done 状态**:随书签处置拍板更新——与发音同法(路由 10 维持 done)或
退回 ready-for-human(书签落地再翻),维护者定。

### 2026-11-09 收官补记:书签拍板 + 修笔 verify → 终审闭环

- **书签处置拍板:立票 10 + 02 维持 done**(与发音→09 同法;10 排期随
  triage,建议与 09 并列 06 收口前)。收官声明以本票上一节的修正为准:
  EPUB 链路已验 = 导入/音标/查词/生词四态/进度/笔记 + 飞行模式 + 杀进程
  持久;发音路由 09,书签路由 10。
- **mutation c 修笔落地**:apps/mobile/test/dictionaryAsset.test.ts
  (?raw 导入双断言:字节同一 + ignore 清单;mobile 测试块禁 Node 全局,
  vite ?raw 在 transform 期内联,process/jsdom 两坑均绕开)。
- **caller 补跑根 `npm run verify`:EXIT=0**(85 文件,1030 passed |
  3 skipped,含新门)。终审 NEEDS REVISION 的三个实项全部闭环:书签路由
  10、字典门补齐、收官声明修正;两项 CONCERN(PDF 措辞、verify 独立
  复证)记档处置如上。02 维持 done。

### 2026-11-16 Codex 独立终审(挂账补跑)

threadId `01a1e1db-a5d2-75f0-9f2f-1c7b4accd86b`,verdict **NO-GO**,只读
未运行测试。发现 3 行为缺陷 + 4 证据缺口,按票面规则全走 follow-up:
- 缺陷 1+2(备份恢复不刷新书架 / listDocuments 不等在途写)→
  `.scratch/mobile-progress-stale-reopen/`
- 缺陷 3 + 缺口 7(词典裸索引原型污染 + 薄条目 fixture 缺失)→
  `.scratch/mobile-dict-proto-lookup/`
- 缺口 4/5/6(词汇后端 catcher / 打签落点断言 / 字典资产门跳过)→
  `.scratch/mobile-test-evidence-gaps/`
三簇代码站点均经编排侧现场核验后立票。验收门判定:EPUB 本地解析/注入缝/
离线资产/笔记/发音 PASS;点词生词与进度落位 FAIL(即上述缺陷);书签与
杀进程重开 PARTIAL(证据缺口);根 verify 为旧树记录(今日全链由
mobile-md-import 收官时的 caller verify 覆盖)。02 维持 done,实项随
follow-up 票处置。
