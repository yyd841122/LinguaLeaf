# readerpage-split:ReaderPage 整固 — 站归模块,页留接线
Status: ready-for-human(2026-11-07 Lane B 收官:实现 9f730f9 + 编排侧 verify EXIT=0 + 双轴评审零硬违规零缺需求;验收门全自动无真机项,维护者签收翻 done)
Status: ready-for-agent(2026-11-07 维护者拍板五题全照推荐,Lane B;实现侧可直接领票)

来源:CODING_STANDARDS.md「ReaderPage hosts wiring; new reading-face
features land in dedicated modules」(2026-11-07 retro bbe5c80 落档)明文
——「Adding another station inline (a new phase, a new host body, a new
data seam) **is a split ticket's job, not a line item**」。三连 Standards
评审独立记压(pdf-notes / ext-note-types / pdf-shelf,2026-11-06/07)后
成文的规则,指名要的正是本票。动机:pdf-shelf 末票把文件推到 818 行,
拆分按票走,现在开票。

Lane:B(2026-11-07 拍板锁定;纯 TSX 结构迁移,六注入缝齐备,沙箱内
vitest 可验;近期 extension 三票均此道)。

## 现状事实(2026-11-07 编排侧现场取数,HEAD=3a75c94)

- **体量与增长曲线**(git numstat + wc 现场):
  74df19a(pdf-word-keyboard)675 行 → a9abd13(extension-notes)
  +68/−23 = 720 行 → c9130f2(pdf-notes)+109/−140 = 689 行 →
  71e1196(pdf-shelf)+185/−56 = **818 行**(HEAD)。「~185 行」指总
  新增,净 +129;四站吸收 = 渲染体/开书链/书架接线/持久化。
- **净减先例在**:c9130f2 抽出 `PdfReader.tsx`(现 356 行)当票净减
  31 行——站归模块即减重,本票有活样版。
- **ext-note-types 未碰 ReaderPage**(4f2d000 numstat:+175/−71 全在
  NoteEditor.tsx)——三连压是评审侧独立记的,非三票都长文件。
- **五站齐载**(标准原文点名):状态机(:69-91)、EPUB host、PDF
  host、word-lookup seam、shelf seam。
- **唯一生产消费点 = main.tsx**;唯一测试文件 =
  `readerPage.test.tsx`(1536 行),六注入 props(:104-118)全部可注
  ——既有测试按「组件接口不变」即可零改写全绿。
- **既有拆分成果共存**:`PdfReader.tsx` 356 / `PdfShelf.tsx` 160 /
  `usePdfShelf.ts` 54 / `EpubChapter.tsx` 151 / `NoteEditor.tsx` 309 /
  `WordLookupPopup.tsx` 11(reading-model 内核薄壳)。
- **站分布(行号为 HEAD 现场)**:
  - 状态机 + 文案:`ReaderState` :69-91、`copyFor` :94-102
  - 缝簇:六 store memo :120-137、persistence settle :138-152、
    shelf(:151-157 usePdfShelf)、open 通道 + acceptedSession 遣散
    (:159-181)、noteEditor :183、dictionary/storePromise/
    resolvedStore :190-208、wordStates :214、lookup :218、library
    :224、recents :229、restoreRef :231
  - PDF 开书链:`acceptPdf` :233-303(fingerprint→openPdf→scanned
    →position→settle→书架存→finally 遣散)
  - 分派 + EPUB 开书:`handleFile` :304-363(含
    DocumentReplacementRequired 确认循环)
  - recents 装载 effect :365-381;`reopenDocument` :394-412、
    `reopenPdf` :413-439;`onPick` :441-444
  - EPUB tint 走读:tintOwner/settle :453-457、逐章 bulk read effect
    :460-490、`handleStatusApplied` :537-545
  - 进度持久化:scroll 节流 effect :492-520、restoreRef 跳转 effect
    :522-535
  - 拖放四手 :547-564
  - 三渲染体:PDF 面 :566-608(~43 行)、EPUB 面 :610-719(~110
    行)、落地面 :721-818(~98 行)
- **tint/进度/状态补丁均为 EPUB 专属**:PdfReader 无 tint/statusOf
  props(现场核 :566-608);`handleStatusApplied` 被 PDF 面弹窗共用
  (:572-577),但 wordStates 补丁在 PDF 相位无可见面(无 tint 渲
  染),EPUB 重开时 `setWordStates(new Map())` 清。
- **点词弹窗每面各自挂载一次**(PDF 面 :569-577、EPUB 面 :704-712
  )——拆体后各模块自持弹窗实例,`onStatusApplied` 下传即可,无共
  享实例障碍。

## 不变量(拆分不得破坏的既有契约,现场锚点)

1. **字节所有权**:picker File 先于 openPdf 保底持有
   (:315 注释;pdf-shelf 裁决 a 的落地现场)。
2. **「Acceptance is the only shelf admission point」**(:281 注释)
   ——存字节只发生在接受之后,不 await 在阅读路径上。
3. **restoreRef 是蓄意的一次性通道,不是反应式状态**(:519 注释
   )——拆分不得把它改成 prop 驱动的反应式重跳。
4. **tint bulk read merge-wins**:本地已持 key 恒赢,popup 补丁与
   在途 bulk read 都不得回退读者刚改的状态(:446-447 注释)。
5. **A→A 重击不复活**:reopen 每击开头 invalidate,失败静默留
   picker(:384-392 注释;settle-channel 02 收编现场)。
6. **六注入 props 接口形状不变**(:104-118)——测试零改写的承重墙。

## 目标形状(2026-11-07 拍板定稿:全拆)

- 新 `EpubReader.tsx`(镜像 PdfReader.tsx 角色):EPUB 渲染体 + tint
  走读 + 进度持久化 + handleStatusApplied(站内聚,tint/进度本就
  EPUB 专属);props down(书/章/音标/缝)、callbacks up(goChapter、
  onWordClick、reopen、……),弹窗自持。
- 新 `ReaderLanding.tsx`(镜像 PdfShelf.tsx 角色):落地面渲染体 +
  拖放四手 + recents 装载;props down(recents/shelf/提示态)、
  callbacks up(onFile、reopenDocument、……)。
- `acceptPdf` 提为独立模块(纯函数化或 `usePdfOpen` hook,实现侧按
  依赖形状定):open 通道 + acceptedSession 遣散随迁。
- `ReaderPage` 余下:状态机 + handleFile 分派 + reopen 编排 + PDF 面
  接线 + 六缝持权——只剩 wiring,约对半减。

## 决策(2026-11-07 维护者拍板五题,全照推荐)

1. **范围 = 全拆**:EpubReader.tsx + ReaderLanding.tsx + acceptPdf 独立
   模块,一步到位按标准终态(ReaderPage 只剩接线)。
2. **tint/进度/状态补丁归属 = 随 EpubReader 走**:站内聚,tint/进度本
   就 EPUB 专属,跨站共享面为零。
3. **测试政策 = 既有断言零改写零删除**(循 annotated-blocks-kernel
   「两宿既有断言零改写」先例);基线计数以跑套件输出为准,勿 grep
   it();新模块不强制新测试,允许加结构钉。
4. **一票、实现侧切片提交**(循 2fff857 先例,评审一次看全 diff)。
5. **Lane = B**(Codex 沙箱实现;编排侧补跑全链 verify + 双轴评审)。

## 验收门(定稿)

- 编排侧 `npm run verify` EXIT=0(门看退出码不看 tail)。
- `readerPage.test.tsx` 既有断言零改写零删除;计数引用一律从跑套件
  输出抄,不手算。
- 公开行为零变:六注入缝、弹层/键盘/音标、书架三并存、EPUB recents
  、进度恢复,全部零回归(既有测试即安全网)。
- 新模块窄缝:props down / callbacks up,循 PdfReader/PdfShelf 先例
  ;ReaderPage 不添新站。
- 基线:评审对照「本票首个实现 commit 之前的 HEAD」(关系表述,不
  预写 SHA)。

## Comments

### 2026-11-07 Lane B 实现与双轴评审(编排侧,收官)

- 实现:job `implement-mw61dge4-pomndg`,threadId
  `01a1b4be-8f69-7512-b6ff-0e422d06d418`,gpt-6.1-sol / high /
  workspace-write / 30min。新增 EpubReader.tsx(259)/
  ReaderLanding.tsx(184)/ usePdfOpen.ts(140,acceptPdf 链
  hook 形态,票面留给实现侧的选择权);修改 ReaderPage.tsx
  (818→385,86+/519−,只余接线)。实现 commit 9f730f9,
  基线 = 0c8c795(本票首个实现 commit 之前的 HEAD)。
- **决策 4 偏差记档**:沙箱 `.git` 只读(index.lock EPERM),
  实现侧切片提交不可达;编排侧单票单 commit 代提交。切片意图
  (2fff857 先例)未达成,但纯结构迁移单票单 commit 的 bisect
  价值无损,评审照看全 diff。
- 编排侧 gate:全链 `npm run verify` EXIT=0(67 files 827
  passed|2 skipped (829),与 pdf-shelf 收官基线零位移)。沙箱内
  typecheck/lint 绿 + 定向 vitest
  (readerPage/readerNotes/pdfReaderNotes)116 通过|1 跳过与基线
  一致;Spec 子代理独立复跑 readerPage.test.tsx 48 passed|1
  skipped EXIT=0。readerPage.test.tsx 不在 diff(既有断言零改写
  零删除,验收门 2 实证)。
- **Standards 轴:零硬违规**,motivating rule(「ReaderPage
  hosts wiring; new reading-face features land in dedicated
  modules」)满足:站体零残留,页只余 props 下传/状态机/缝。
  judgement-call 4 条记档,引文现场核验 4/4 属实:①closeNote
  同形两处(ReaderPage.tsx:143 / EpubReader.tsx:48,共享 ref
  下传,提取须跨模块耦合,两行 lambda 不值);②onToggleIpa 内联
  两处(ReaderPage.tsx:355/:379);③ReaderLanding 五 props 原样
  转发 PdfShelf(entries/bytes/positions/refresh/failed,Middle
  Man,分拆固有成本,landing 组合 picker+shelf 期间接受);
  ④pdfBytes+pdfPositions Data Clump 伴行(usePdfOpen 与
  ReaderLanding→PdfShelf 两路)。另 naming 走查一条:
  `shelf: ReturnType<typeof usePdfShelf>["snapshot"]`
  (ReaderLanding.tsx:30)可换具名导出。批次记档:WordClick
  内联孪生本票后漂至 ReaderPage.tsx ~171-174
  (EpubReader.tsx:5 已 import 该类型),已补 types-alignment
  位点 1 漂移注记。无 SQL/契约套件/测试/文案规则触发。
- **Spec 轴:substantially compliant**——六不变量引文逐一现场
  核属实:①字节所有权注释原样(ReaderPage.tsx:198);②收票
  唯一点(usePdfOpen.ts:116,save 队列 + refreshPdfShelf 在);
  ③restoreRef 一次性通道(EpubReader.tsx:124,ref 对象下传、
  effect 一次性消费,非反应式);④tint merge-wins
  (EpubReader.tsx:56-64);⑤A→A 不复活(ReaderPage.tsx:249-253
  握手注释原样,reopenDocument/reopenPdf 未触碰);⑥六注入 props
  签名未动(测试零改写全绿即证)。目标形状全落地(镜像
  PdfReader/PdfShelf 先例,props down / callbacks up,弹窗各面
  自持)。记档 3 条(均行为保持的保真机制,票面未点名):
  ①ReaderLanding 常驻自隐(:10 注释 + :85 `if (phase === null)
  return null`,recents effect 门 `phase !== "empty"` :45——旧
  emergent 页面寿命改显式结构决策);②scrollSaveAt 节流钟上提
  host(ReaderPage.tsx:185/:377 下传,EPUB 面重挂载间保钟);
  ③PDF 面弹窗 `onStatusApplied={() => undefined}`
  (ReaderPage.tsx:331-332,PDF 相位无 tint 渲染面,旧
  handleStatusApplied 补丁写入本即死码 + EPUB 入场清零——接线
  恒同化,与决策 2「跨站共享面为零」一致)。
- **验收门全自动,无真机检查点项**(既有 1536 行测试即安全网,
  票面验收门四条全绿);维护者签收翻 done。可选抽验(非门):
  浏览器开 EPUB 阅读面 + 落地面 + 开 PDF 各一圈,与拆分前观感
  恒同。
