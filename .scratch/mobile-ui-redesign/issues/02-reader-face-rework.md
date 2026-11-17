# 02 阅读页改版(无框化 + 呼出菜单 + 排版 + PDF 面)
Status: done(2026-11-17 收官:Codex NO-GO→修笔全清(High 双重边距 + 5 Med + Low 记档)+ verify 补跑 EXIT=0(抓到一处负载时敏断言当场加固);真机矩阵归 04;见 ## Comments)
Blocked by: 01

## 目标

微信读书交互范式 + 参照图排版,EPUB 与 PDF 两种阅读面一次收口。这是全改版最大的一票。

## 范围

**撤除**(连测试一起清)
- EPUB:常驻三行 sticky 头(书名 / 听书条 / 工具行)、footer pager、置顶 / 置底按钮、`pdfToolbar` 偏好
- PDF:常驻工具行(原版与重排两视图)

**点按呼出(再点收起)**
- 顶栏:← 返回 | 书名·章节名(EPUB)/ 书名·页码(PDF)| 进度
- 底栏图标行——EPUB:目录 / 书签 / 音标 / 译文 / 翻译 / 听书 / Aa;PDF 同构减法:**保留音标**(原版 + 重排,`PdfReader.tsx:161` 现状)、**无译文**(EPUB 专属)、增 zoom 阶梯 + 重排 / 原版切换
- 听书二级面板:播放 / 句步进 / 倍速(现听书条整条收进去)
- Aa 面板:字号 5 档(1.0/1.15/1.3/1.45/1.6rem)、边距 3 档(12%/17%/22%,默认宽照图)、行距 3 档(1.5/1.75/2.0,默认 1.75 照图)、主题(01 机制);字体族不换、不引字体资产
- 目录面板:EPUB 章节列表 + **章节进度滑杆**(章节索引百分比——spine 身份已丢不可用,评审 10 条);PDF 页导航

**点按分区与热区(评审 13 条)**
- 优先级:词 / 笔钮 / 弹窗 > 菜单背景点;菜单只响应落在**非交互背景**的点按
- 边缘热区宽 = **实际边距档**(非固定 22%);EPUB = 前 / 后章,PDF 原版与重排 = 前 / 后物理页(ADR-0009 修订)
- 定义:拖动 / 长按取消翻页、选择文字期间禁翻、章首 / 章末(首页 / 末页)边界行为

**排版与标注降噪**
- 档位作用于**纯文字行**;音标开启时定义**最小有效行距**(kernel `line-height: 2` 双倍预留 vs 1.5 档 + 0.72× 音标的相撞处理,经 app 侧覆盖不动 kernel,评审 11 条)
- 音标 ~0.72× + 暖灰、译文 muted;两开关全关时回落 1.75 纯文字疏朗感
- 章首版式:居中序号小字 + 通栏标题(仿参照图)

**逐书学习开关(评审 2 条,拍板 a——新增能力)**
- 音标 / 译文两开关逐书持久化(per-book 键);默认值 = 现全局值迁移;换书 / 冷启 / 返回书架行为定义并测试

**锚点契约迁移(评审 6 条)**
- 阅读进度与书签落点锚**独立于呼出菜单几何**(现 `.reader-head` 底边 + 96px 兜底随之废退)
- 保留:笔记未保存拦截、听书进度所有权

## 验收门

- 菜单收起时阅读面零常驻 chrome
- **全组合矩阵**:字号 × 边距 × 行距 × 音标 / 译文开关,含长音标词、窄屏,不撞行不溢出
- 菜单呼出 / 收起**不改**书签落点与阅读进度;排版调整后重开位置正确
- 逐书开关:换书各记各的、冷启恢复、默认迁移正确
- PDF 双视图矩阵:菜单 / 翻页 / 缩放 / 返回在原版与重排各自全过;原版纸面不套主题
- touchPolish 44px 底线与命中区规则在新菜单全量适用
- 真机:点按 / 呼出 / 翻章 / 翻页无误触;点词查详情、笔钮、弹窗优先级正确

## Comments

- 2026-11-17 开工(Lane A,Claude 直做)。工作计划(纵向切片,每片
  TDD + 全绿再进):
  - **A 存储基座**:ui-settings v2→v3(+typography 全局档位:字号 5 档/
    边距 3 档/行距 3 档,迁移保留 theme;默认 1.15rem/22%/1.75);新
    learning-settings 逐书学习开关 namespace(ipa/translation,默认
    true=现全局值;换书/冷启/返回书架行为:逐书读、写即存)。
  - **B 呼出菜单 + 撤常驻**:菜单态(收起|呼出|二级面板:目录/书签/
    听书/Aa);点按分区(中央呼出、左右边缘翻章/翻页、优先级 词/笔钮/
    弹窗>背景、拖动/长按/选中禁翻);撤 EPUB 三行头 + footer pager +
    置顶置底 + PDF 常驻工具行(01 已退役持久化,02 撤 UI);**锚点迁移**
    ——readingAnchorTop 从 .reader-head 底边改为独立于菜单几何的常量/
    视口锚,验收 = 菜单开关不改书签落点。
  - **C Aa 面板 + 排版应用**:面板 UI 消费 A 的档位 + 01 的主题四档
    (saveTheme 经面板驱动,hook 需暴露保存);CSS 变量驱动边距/字号/
    行距;音标开启时最小有效行距(kernel line-height:2 的 app 侧覆盖);
    章首版式(居中序号+通栏标题);音标 0.72×、译文 muted、全关回落
    1.75。
  - **D PDF 面**:同构菜单(保留音标、无译文、增 zoom 阶梯 + 原版/
    重排切换 + 页导航);边缘 = 物理页(ADR-0009 修订)。
  - **E 矩阵验收**:全组合矩阵(字号×边距×行距×两开关,长音标/窄
    屏)、PDF 双视图矩阵、touchPolish 底线全量适用、票面验收门逐条。
  - 顺手:style.css 盖 Georgia 死规则收口(01 发现条)。
  - 现状锚点:readingAnchorTop = .reader-head 底边(EpubReader.tsx:69,
    兜底 96px);音标 = ReaderPage 全局 state 默认开;译文 = EpubReader
    局部 state 默认开;PdfReader 工具行 :128-250(音标 aria-pressed
    :148、置底钮 moveToolbar)。

- 2026-11-17 进度:切片 A/B/C 已落地(commits:切片 A 排版档位入 v3 +
  learning store;切片 B EPUB 呼出菜单/点按分区/撤常驻/锚点 96px 常量化/
  逐书开关;切片 C Aa 面板 + 排版 CSS 变量化 + 章首版式入 EpubChapter)。
  mobile 48 文件 469 过 1 skip 全绿。**剩:切片 D(PDF 面)+ E(矩阵
  验收 + 票面逐条)**。D 要点:PdfReader 撤常驻头/工具行/页码行(pager
  一并撤,页码入菜单顶栏);ReaderMenu items = 目录(页导航面板:页码
  输入+跳转)/书签/音标/Aa + zoom 阶梯(0.75/适宽/1.5)+ 原版/重排切换;
  无译文/无听书;边缘带 = 物理页(两视图同);音标逐书化(learning 注入,
  ReaderPage 的 showIpa/onToggleIpa 对 PdfReader 退役,全局态删);
  .reader-shell 的 .reader-tools 死规则与 touchPolish PDF 断言随撤;
  pdfReflow/pdfReaderBookmarks/pdfReaderNotes/pdfRendering 测试迁移
  (summonMenu 先行,helper 已在 test/reader-picker.ts)。E 要点:全组合
  矩阵(字号×边距×行距×两开关,长音标/窄屏)、PDF 双视图矩阵、票面验收
  门逐条打勾、风格收口(style.css Georgia 死规则顺手)。

- 2026-11-17 Lane A 实现完毕(五切片五 commit,基线 = ef62e7e 之后的
  HEAD):A 存储(ui-settings v3 typography + learning-settings 逐书)→
  B EPUB 呼出菜单/点按分区/撤常驻/锚点 96px 常量化 → C Aa 面板 + 排版
  变量化 + 章首版式 → D PDF 面同构(物理页边缘带/页码面板/zoom 入菜单/
  AaPanel 共享)→ E 全组合矩阵 + 收口。要点拍板与发现:
  - **锚点**:readingAnchorTop 改常量 96px(原 .reader-head 活测的兜底
    值)——菜单几何无关,「呼出/收起不改落点」由构造保证并有测试。
  - **点按优先级实证**:NoteEditor 的 capture 阶段外点守卫 = 「弹窗 >
    菜单背景点」的天然实现;脏稿期间无法呼出菜单属预期(测试按此写)。
  - **设置入口过渡**:阅读面设置钮随工具行退役,书架设置承接至 08 我页
    (未配置提示文案已改「返回书架,在 设置 里填写」)。
  - **行距契约**:--reader-leading = 音标开 ? 2(kernel 双倍下限,评审
    11 条) : 梯值;纯文字行归梯。音标 0.72×(--ipa-size em 化)、译文
    muted、章首居中序号+通栏标题。
  - **发现并收口**:reader.css 的 Georgia font-family 自打包序以来即
    死规则(style.css 后位必胜),本票删除;1.7 行高移 shell body 单源。
  - **waitFor 风暴教训**:重试回调内做 dismiss+summon 双 toggle 会引爆
    MutationObserver 重试风暴(单测 20887 次重试实证),测试读菜单态
    一律幂等(开过就不关)。
  - 验证:mobile 48 文件 471 过 1 skip(每 commit pre-commit 全量链);
    tsc/eslint 零告警。新测:readerMenu 4 + tapZones 3 + readerMenuFace
    15(呼出/词优先/选中禁/边缘边界/逐书往返/锚点不变/Aa 变量+持久化/
    主题即选/章首/180 态矩阵)+ uiSettings v3 10 + learning 5;迁移
    六套旧 UI 测试(summonMenu/dismissMenu 幂等助手入 test/reader-picker)。
  - 待办(caller):双轴 + Codex 审核 → verify 补跑;**视觉半场归 04 票
    真机矩阵**(180 态 jsdom 只钉变量接线,不撞行/不溢出/长音标/窄屏
    需真机);触摸拖动/长按的真机行为同归 04。
- 2026-11-17 双轴评审(/implement 内置,Standards/Spec 并行):Standards
  1 硬 + 4 判,Spec 1 真缺口 + 2 小项,全修于本 commit:
  ①**章节进度滑杆**(Spec 真缺口,原被无声丢)→ 目录面板补 range 滑杆
  (章节索引百分比,评审 10 口径,拖动即跳章带脏稿守卫)+ 滑杆/百分比
  断言测试;②空壳 it.each「PDF 双视图矩阵」删(双轴共识;真覆盖在
  pdfReflow/pdfReader* 三套件,prose 记录覆盖图);③菜单状态机抽
  useReaderMenu、逐书开关抽 useLearningToggles(save 移出 setState
  更新器,StrictMode 双发隐患);④MARGIN_STEPS 改 [值,标签] 元组(位置
  并行数组消失);⑤顶栏补书名·章节名;⑥锚点测试改名为实际钉的事实,
  补「呼出/收起不改阅读进度」+「排版调整后重开位置正确」半场(菜单
  双向开关前后 exportProgress 不动;改字号 → 返回重开 → 章节与进度
  复原);⑦reader.css 过时 head 注释更新。
  修笔中引入又修掉:**keys 进 effect deps = 无限 load→setState→重渲
  循环**(字面量数组每渲染新 identity;全量套件 5000ms 超时三处,单跑
  复现后 stash 二分定位)——deps 注释钉死教训。修后全 mobile 48 文件
  471 过 1 skip,tsc/eslint 零告警。
- 2026-11-17 Codex 独立审核(threadId 01a1e729-50b8-7ea3-b8b3-47d909e06096,
  gpt-6.1-sol · high · read-only,job review-mwk0z3ww-1tedf4):**NO-GO**——
  1 High + 5 Medium + 1 Low,逐条裁定全部成立,当场修毕:
  - **High·PDF 重排双重边距**:外层 .reader 与内层 .pdf-reflow 都吃
    --reader-margin,22%² 正文仅 ~31% 屏宽——撤内层 padding,单容器承担。
  - **Med·拖动/长按取消翻页未实现**:「真拖动不产 click」是假设——抽
    ReaderEdge 组件(pointerdown 起跟踪,漂移>12px / >500ms /
    pointercancel 皆判取消 + 选中守卫),两面消费,flipGuard 退役。
  - **Med·原版改边距不重算适宽**:PdfPage key 增 marginStep,边距变即
    重挂重适配。
  - **Med·逐书开关晚到读覆盖用户选择**:touched 键集守卫,读回不得
    覆写已动过的键 + 延迟读竞态测试。
  - **Med·证据缺口五项**:锚点测试升三向区分几何(-300/90/110,锚 0 与
    锚 150 变异均实测红);重开非零块 + scrollIntoView spy;滑杆脏稿
    矩阵(拒/纳);页码面板 clamp + 跳转;首末页 disabled;选中点活边
    缘不翻;A→B→A 异书逐书(Second Book 独立 docId);load 每挂载恰一
    次(keys-in-deps 教训的有界断言)。
  - **Low·底栏图标行未实现**:文字钮(可访问名齐全)先行,图标表达随
    P3 10 票换皮统一落——记档待维护者确认。
  修后:mobile 48 文件 **479 过 1 skip**(较审核前 +8 测),tsc/eslint
  零告警。审核未认证历史计数(只读跑不了套件),以本条为准。
- 2026-11-17 收官:caller `npm run verify` **EXIT=0**(全量链含 build)。
  首跑抓一处负载时敏断言(pdfReaderNotes Escape 关闭编辑器同步查
  queryBy 赶空窗,全量并行下晚一拍),改 waitFor 后复跑过——正合第四轮
  17「触及的测试随票修时序」。翻 done。余项:04 票真机矩阵(视觉半场/
  触摸真行为/无误触);底栏图标行(Low)随 P3 10 票换皮,待维护者确认。
