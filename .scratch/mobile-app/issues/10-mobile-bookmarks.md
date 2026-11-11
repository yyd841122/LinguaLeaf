# 10 移动端书签:当前位置打书签 + 目录跳回
Status: ready-for-human(2026-11-11 实现收官:根 verify EXIT=0、双轴评审 3 修 4 记档;真机三项人验待做,见 Comments 与用户操作项)
Blocked by: 02

## 问题

spec story 11(「我要在当前位置打书签并从目录跳回」)与 Solution 段、
02 验收门都写了书签,但**扩展阅读器从未有过书签能力**(书签是 apps/web
的 reading-bookmarks 特性:apps/web/src/bookmarks.ts / bookmarksSession.ts)——
02 按 D12 搬移扩展基座,无书签可搬;八票计划也没有书签票。02 收官审核
(Codex,2026-11-09)判为首要失实项:门里写了书签,树里没有,收官记录
「书签已全验」是空验。spec.md:12 的事实句已勘误,本票承接能力新建。

## 拍板(2026-11-11;①维护者拍板,②③编排侧定)

1. **时点:批 (a) 提前**——先于 03/05 落地(维护者 2026-11-11 拍板);03/05
   验收门的书签项随本票原样可过,两票领票前注的顺序茬解除。
2. **形状:沿用 web 书签模型语义,数据缝走 mobile 自己的 IDB namespace**
   (02 全部 store 同形,共享内核不动):
   - 行模型对齐 wire `BookmarkSummary`(apps/server/src/wire.ts:121):
     `{ id: number; chapter: number; block: number; createdAt: string }`;
     id 为本地自增整数(record 内 nextId 计数);跨端 id 冲突的合并语义
     归票 05 导入侧处理,本票不管
   - 同位添加幂等:已有 (chapter, block) 相同的行 → 返回既有行,不重复落
     (web 201 新建/200 已有的语义)
   - 列表按 (chapter, block) 升序
   - **不设每书上限**:web 的 cap 是服务端卫生,本机数据无此需要;备份
     互通无冲突(PC 上限内的量必小于无上限)
   - 会话裁决:useOwner/useSettle(mobile 译文读取同法,web
     bookmarksSession 同语义)——失败一条旗可读、下一次成功清,不弹窗;
     换章/换书不复活旧行(cleanup flags revoke once)
3. **02 验收门「书签」字样**:在 02 票面 Comments 标注路由(书签 → 本票),
   不改历史门文本(与发音→09 同法)。

## 范围(EPUB;PDF 书签归 03)

- `apps/mobile/src/store/bookmark-store.ts`:纯 IDB namespace record +
  memory twin(translation-store 同形);接口 `list(docId)` /
  `add(docId, { chapter, block })`(幂等,见拍板②)/ `remove(docId, id)`
- 阅读面(apps/mobile/src/reader/EpubReader.tsx):头部加「书签」按钮 →
  面板(票 04 settings overlay 同形:veil+card);面板按升序列书签行
  (章题 + 删除 ✕),点行跳回
- **打书签坐标 = 当前 chapterIndex + 最顶可见 sentence 块 index**——进度
  落库的滚动监听已在算这个数(EpubReader 进度 effect),勿另造定位
- 跳回 = 切章 + 滚到块:复用既有块锚 `[data-block-index]` scrollIntoView
  (EpubChapter 每块已带 data-block-index;章恢复滚动即此法);跨章跳的
  渲染时序以既有恢复 effect 解法为准
- PDF 书签(page 目标)**不在本票**:03 的门已写「与 EPUB 同权」,届时以
  本票 store 扩 page 目标接入,门文本不改
- 扩展 / web / server 不动(纯 mobile 新缝)

## 验收门

- 根 `npm run verify` EXIT=0(编排侧补跑)
- vitest:store(增删查、同位幂等、升序、持久化 twin+record 双验);阅读面
  (打书签入列、跳回切章滚到位、删除、失败旗可读可清;settle-channel
  不变量:换章/换书不复活旧行)
- 真机【人验】:当前位置打书签、列表跳回、删除;杀进程重开仍在

## 用户操作项(人做)

- 真机:打书签 / 跳回 / 删除三项 + 杀进程重开验证

## Lane(领票时定,2026-11-11)

纯 TS/React、票面自包含、jsdom 可验 → **Lane B**(`/cc-suite:implement`);
编排侧补全链 verify + 双轴评审;真机人验留维护者。

## Comments

### 2026-11-11 triage 完毕,翻 ready-for-agent

存根三问全拍板(见 ## 拍板):①维护者选 (a) 提前,03/05 顺序茬解除,
两票领票前注已回写;②形状按「沿用 web 语义 + 自有 IDB namespace」定,
不设上限、同位幂等、id 本地自增;③02 门书签字样已在 02 Comments 路由。
票面补全范围/验收门/Lane,基线记法:the HEAD before this ticket's first
implementation commit。

### 2026-11-11 实现收官(Lane A 中途翻转)

**Lane 翻转记档**:领票按票面走 Lane B(`/cc-suite:implement` 后台作业
implement-mwbghwlr-6o6wcy),Codex 死于额度触顶(rawOutput 空、零产出,
11-15 10:55 恢复)。维护者拍板翻 **Lane A**:Claude 直接实现,双轴评审
(Claude 子代理)兜底,**Codex 独立终审 11-15 恢复后补跑**(02 票 usage
触顶改期同法;settle-channel 01 维护者点名翻转先例)。实现 commit:
`feat(mobile): 票 10 书签`(10 文件 +932/-19)。

**门**:根 verify 两跑——首跑 EXIT=1(extension pdfReaderNotes it.each
第 4 变体找不到 alert,单文件两跑全绿判孤发抖动),全量重跑 **EXIT=0
(100 文件,1113 passed | 3 skipped,较票前 +2 文件 +17 测试)**。

**双轴评审裁决(3 修 4 记)**:
- 修①:settle 不变量测试原是装饰性(变异探针:删 teardown invalidate
  全绿——两次 gated 读返回同值)。改为陈旧读携带可区分多行,删 invalidate
  时探针红得精准(实跑验证过)。
- 修②:jumpTarget 内联 `{chapter, block}` 与 `BookmarkTarget` 类型孪生,
  收编为具名类型(票内采纳条款)。
- 修③(Spec 轴实锤):面板开着的 list 读未落时打书签,行先并进 UI、旧
  快照落地整表覆盖,行从面板消失直到重开。修法:打书签按钮等 list 落地
  才解锁(disabled-until-landed),测试同步加等待位。
- 记不修:`Record<string, DocRecord>` 裸访问(hasOwn 规则)——translation-
  store 全 seam 家族同形,单点修造成分叉,批量清扫候选(与票 04 的
  (docId, chapterIndex) 裁决同族);overlay-* 改名(票面「同形」的更优
  解,Standards 轴反点赞,无孤儿选择器);行内时间戳(票面速写外的
  小字段,同章多签的区分事实);「删除」文字按钮 vs 票面速写「✕」
  (aria-label 同语义,真机更可发现)。
- 「换章/换书不复活」门项:结构性无虞(veil 挡住开面板切章;关闭即
  close→reopen 已测点亮;换书=面卸载通道同灭),记构造性覆盖。

**勿忘(人验后)**:①真机三项 + 杀进程重开,回报后翻 done;②Codex
额度 11-15 恢复后补独立终审,发现实项按 follow-up 处置。

### 2026-11-11 人验 round 2 返修(维护者真机反馈两缺陷,已修)

维护者在长测试书(The Lighthouse Diary,8 章,`.scratch/mobile-app/
gen-long-epub.mjs` 可再生)上人验,反馈:①「点了书签,没看到具体标识」;
②「章节过长,每次要返回到顶端打标签,明显不对」。

**根因(互相咬合)**:`reader-head` 工具栏非粘性,随页滚走——读到章中
想打签必须滚回页顶去够按钮,`topmostVisibleBlockIndex()` 算出的自然是
章首块(①的面板行全是章 1/章 2 顶位,设备上实证 6 行全是);且被标记
的块在正文无任何视觉记号,跳回章顶等于什么都看不见。讽刺处:
`READING_ANCHOR_TOP` 注释本来就写着 "crossed under the **sticky
head**"——设计意图是粘头,实现漏了。

**修复(commit `fix(mobile): 票 10 书签人验返修`,4 文件 +126/-22)**:
- `reader-head` 改 `position:sticky;top:0;z-index:10;background:canvas`
  (canvas 系统色双主题遮底;z 序核对:粘头 10 < 查词弹窗 20 < 面板
  veil 40 < 笔记弹窗 100)
- 书签行改「挂载即读」(正文记号数据源 + 打签幂等基线;失败静默——
  记号 best-effort,面板开启读同通道兜旗),面板开启读语义不变,
  陈旧票不变量原样(test 7 门控挪到第 2 次调用,calls 2→3)
- `EpubChapter` 新增 `markedBlocks?: ReadonlySet<number>`,被标记块挂
  `.block-marked`(inset box-shadow 紫边 + 淡紫底——不用 border/
  padding,标记出现零回流);面板关闭记号仍在(关闭不重读不置空)
- `[data-block-index]` 加 `scroll-margin-top:96px`:跳回/恢复锚点停在
  粘头之下,与 `READING_ANCHOR_TOP` 同一净空事实两处声明
- test 6 失败语义改序无关(挂载读也走 list 了);新增记号测试
  (打签块挂 class、未打签块不挂、面板关后仍在、删除后褪去)

**门**:根 verify **EXIT=0(100 文件,1114 passed | 3 skipped,+1)**。
**真机实证(PCAM00,横屏)**:滚两屏后工具栏仍钉顶 → 章中「在当前
位置打书签」→ 关面板,被标记句("watch the sky at noon")左侧紫边+
淡紫底可见 → 再滚走、面板跳回,落点即标记块、恰在粘头之下(96px
避让生效)。设备上旧 6 条顶位测试签未清,留维护者随手删。

**待办**:维护者按上清单复验(①打书签 ②跳回 ③删除 ④杀进程重开,
这次在长书章中进行);Codex 终审 11-15 补跑时含本返修 diff。
