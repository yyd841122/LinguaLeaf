# 02 — EPUB 头部：听书组按钮改小、排到书名下方

Status: done

## 现象与实测

用户：与听书在一起的几个按钮太大、占地过多，要求改小并排列在书名
下方。

真浏览器实测（HEAD dist，412×915，evidence/geometry 见票面 Comments）：
`.reader-head` 是单行不换行 flex（`align-items: baseline; justify-
content: space-between`），07 又把 `.readaloud-bar` 作为第三个子节点
塞进来：

- 标题被挤成 124px 宽的竖条（h=114）。
- 工具行 8 钮溢出（「返回」left=417 > 412，出屏）。
- 听书条整组被推出屏外（left=462），内部按钮在 31px 宽里逐个竖排成
  4×~57px 的高塔；header 总高 268/915px。

PDF 面早有解法（d3ae5cb round 12：`.reader-shell .reader-head` 改
`flex-direction: column`），EPUB 面的基类规则从未跟进。

## 修法

1. `EpubReader.tsx`：DOM 序调整为 标题 → 听书条 → 工具行（听书组直
   接位于书名下方；工具行置底时为 标题 → 听书条 + 底部固定行）。
2. `reader.css`：
   - `.reader-head` 基类改 `flex-direction: column; align-items:
     stretch; gap: 0.4rem`（sticky 常驻、canvas 底色不变；
     `readingAnchorTop()` 本就活测 head 底边，进度/书签锚点自适应）。
   - `.reader-tools` 加 `flex-wrap: wrap`（窄屏兜底，≥360px 无行为变
     化）。
   - 听书组紧凑化（用户点名改小）：`.readaloud-bar button` 低于触控
     底线——`min-height: 0`（域内豁免，笔钮同款先例）+ `font-size:
     0.85rem` + 紧凑 padding；命中区按票 06 豁免模式 `::after` 外扩
     补偿（视觉 ~24px，命中 ~38px）。
3. `touchPolish.test.ts` 静态钉：head 列向、听书钮豁免+命中区、
   以及 EpubReader 头部 DOM 序（听书条先于工具行）三件（沿笔钮钉
   的形状；DOM 序钉为评审后补录，票面与实现同步）。

## 验收门

- npm test 全量绿。
- 真浏览器（412 与 360 宽、light+dark）：header 高较 268px 显著下降；
  听书组四钮全部在屏内、单行、位于书名正下方；工具行 8 钮全部在屏内。
- 「音标」开关行为回归不回归均照旧（与票 01 一并真机人验）。

## 人验（caller）

- 重装 APK：书名整行可读；书名下方一行小按钮（听书/上一句/下一句/
  语速）；头部不再占近三分之一屏。

## Comments

**2026-11-16 实现 + 评审闭环（Lane A）**

- 实测（修复前，412×915 真浏览器）：head 单行 flex——标题 124px 竖条、
  「返回」left=417 出屏、听书组 left=462 整组出屏竖排（4×57px），
  head 高 268px。
- 修复后（412/360 × light/dark 全绿）：head 186px（−31%），标题整行
  380px，听书四钮单行 28px 位于书名正下方（title.bottom=62 →
  readaloud.top=68），12 钮全在屏，音标开关回归正常。截图
  evidence/after-412-{light,dark}.png。
- 双轴评审采纳两笔：命中区改 inset ±0.35em + 行距 0.6rem ≥ 外扩
  （±4.8px×2=9.5px < 9.6px，换行时命中区不重叠——Standards P2
  「留观」收口为当下修）；DOM 序静态钉补录票面。padding-bottom
  0.75→0.6rem 与条内 gap 调整属「紧凑化」意图内（Spec 记档，未回退）。
- npm test 112 文件 1267 过 | 3 skipped；APK 已重装。
- 待人验：真机看头部布局（书名整行；书名下方一行小听书钮）。

**2026-11-16 round 2（用户真机反馈 + 修笔）**

- 反馈:「置底」的工具行变大了。真机实测归因:我加的 `flex-wrap:
  wrap`「窄屏兜底」在真机 UA 按钮字体下(每钮 43px 宽,桌面 Georgia
  才 29px)把 8 钮折成两行 44px——固定条 61→113px。撤 wrap,恢复原
  单行收缩行为(flex 默认 shrink)。桌面浏览器测试看不见此差异,字体
  度量不同——此教训入档:布局兜底先量真机 UA 字体,勿凭桌面度量加
  换行。
- 修后真机(360×748):固定条单行 h=61,8 钮同行(返回 right=344<
  360);head 83px(标题+听书行 top=68);听书四钮 28px 单行。开关
  375↔0 正常。
- 根 npm test 112 文件 1267 过|3 skipped。翻 done。
