# 06 第一批收口:触控/安全区/深色跟随(exit gate)
Status: done(2026-11-09 立票;to-spec 补全轮定名 exit gate;/to-tickets 补全轮重编号,原 05)
Blocked by: 04 + 05(两线汇合)

## 目标

第一批移动端体验收口:触控目标、安全区、深色模式跟随系统、键盘遮挡。

**定位:第一批 exit gate——有意为之的横向收口票**(to-tickets 纵向纪律的显式豁免):打磨项天然横切同一批样式与布局,拆散会让多票验收变糊。各票(01-05)实现时自带触控最低标准,本票是第一批的总质量门;若领票前维护者改主意要拆散,备选拆法:安全区→01、触控目标→02、深色跟随→04、键盘遮挡→04/05。

## 范围

- 触控目标尺寸与间距:点词命中区、弹窗按钮、显示开关
- 安全区 insets:刘海/手势条不留白不错位
- 深色模式:prefers-color-scheme 跟随系统;现状取数(2026-11-09):apps/web/src/style.css 无 @media 断点,packages/reading-model/src/annotated-style.css 仅一条 640px——暗色既有面以现场量定再动,不预设规模
- 键盘场景:笔记编辑、key 输入不被软键盘遮挡

## 验收门

- 根 verify EXIT=0
- 真机【人验】:日常操作无误触;系统切暗色 App 跟随;笔记编辑键盘不遮输入框

## Comments

- 2026-11-16 领票 + 现状取数(Lane A)。基线:viewport-fit=cover 已在
  (insets 可用);style.css 已声明 color-scheme: light dark 但 reader.css
  60 处硬编码浅色(19 个不同色值)——暗色下 body/canvas 跟随变暗而卡片/
  弹窗仍白、#22342a 级文字不可读,现状即坏,非「无暗色」而是「半坏」;
  工具行按钮无样式(UA 默认 ~21px 高);NoteEditor 已听 resize 重定位但
  AndroidManifest 无 windowSoftInputMode(键盘 resize 不保证触发);
  词详情弹窗(内核)resize 即关,键盘线不涉它。

- 2026-11-16 四线拍板(实现前):
  ①触控:全体交互件 min-height 44px(工具行 9+ 钮,横向不加 min-width
  防溢出,靠 padding-inline 撑宽);点词 span(.lookup-word/.ipa-word,
  内核类名、app 侧加规则不动内核)加 ::after 扩命中区(纵向 -0.3em、
  横向 -0.25em,容忍词界轻微重叠)。
  ②安全区:.reader 与 .reader-shell 的 padding 换 max(基准, env(
  safe-area-inset-*));overlay 卡容器加底部 inset。零值时 max() 保基准,
  纯增量。
  ③深色:reader.css 19 色 token 化(:root 变量)+ 一段 @media
  (prefers-color-scheme: dark) 覆写;内核共享选择器(.lookup-popup/
  hover tint/muted)在 app 侧 dark 块覆写(不动内核表,web/ext 不受
  影响);canvas/gray 系统色跟随 color-scheme 自适应,保留;PDF 画布
  面纸色恒白(纸就是纸),周边走 token。
  ④键盘:manifest 补 windowSoftInputMode="adjustResize"(布局视口随
  键盘收缩 → 既有 --shell-h 重钉 + NoteEditor resize 重定位链路生效);
  NoteEditor 加 visualViewport 边界钳制带(belt,jsdom 无 vv 走守卫可
  mock 测);overlay-card 补 overflow-y:auto(key 表单可滚)。

- 2026-11-16 真机机检(OPPO,API 30,装机 10c6019):四线全过。
  ①触控:底置工具行实测 132px@3x=44dp;②深色:五轮迭代——WebView
  默认向页面报 light(静态/jsdom 不可见),algorithmic(<33 轻主题)无效
  → FORCE_DARK_ON → AUTO(双向实时)→ 每调用独立兜底(ColorOS 缺
  strategy 成员曾一废全链);终态渲自家暗色 token 非渲染器反色;③键盘:
  adjustResize 生效,设置页密钥输入框完整可见于 IME 上方;④安全区目测
  无裁切。Codex 评审(含修笔)已发。人验项中「日常操作无误触」需日常
  使用面检验,留给用户随手反馈。

- 2026-11-16 Codex 审核(threadId 01a1e409-003a-7e11-bc15-8bc2ff26b3de,
  849dbba+10c6019 深色部分):**NO-GO 2P1+2P2+证据缺口**,全修于 dd6045d:
  ①:root 先于 @import 致内核共享表整份被丢(postcss 规则,jsdom/静态
  测不可见)——token 块移位+样式表完整性钉;②命中区 relative 同特异度
  后位覆盖画布笔钮 absolute——:not(.pdf-note-button) 豁免+双向钉;
  ③vv 钳制缺下界;④内核暗色覆写不完整(六选择器补全+枚举钉)。另按
  评审更正 MainActivity 注释的 API 33 因果、touchPolish ruleBody 剥注
  释(探针:button→a 靠注释词仍绿)。四变异咬合;verify 112 文件 1263
  绿。收官翻 done。人验余项:日常误触感 + TTS 听感(用户随手反馈)。
