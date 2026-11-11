# 10 移动端书签:当前位置打书签 + 目录跳回
Status: ready-for-agent(2026-11-11 triage 完毕:三问全拍板见 ## 拍板,Lane B)
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
