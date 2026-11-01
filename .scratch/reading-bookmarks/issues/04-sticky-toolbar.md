# 04: 顶栏吸顶——深位打点入口常驻可达

Status: done

来源:/grill-with-docs 2026-11-01,重开 T10×P5(03 浏览器验收发现「交维护者
拍板」项)。拍板:吸顶工具栏;spec 决策 8 已增吸顶子句,决策 7(T10)一字不改。

**What to build:**

- `apps/web/src/style.css`:`.reading-top` 改 `position: sticky; top: 0`
  (整行:书名 + 打书签/目录/显示设置/翻译)。**sticky 挂 .reading-top 不挂
  .reading-header**——sticky 受父包含块约束,header 的父 .reading-top 只有
  header 自身高,挂在 header 上永远吸不起来。
- 吸顶态视觉:补背景(正文从栏下滚过不得透字)与底边框或阴影;z-index 取
  正值压过静态正文、低于 `lookup-popup`(`position: fixed; z-index: 20`,
  挂在 .reading-top 外层,弹窗必须仍压栏上)。目录/设置面板(absolute,
  z-index: 10,锚定 .reading-top)随栏吸起,顺带章中可达。
- `scroll-padding-top` 配套:恢复与显式跳转走 `blockEl.scrollIntoView()`
  (progressSession.ts:163),目标块对齐视口顶,吸顶后会钻进栏下——滚动根
  补 scroll-padding-top(或块级 scroll-margin),自动恢复/书签跳转两通道一并
  兜住;`window.scrollTo(0, 0)`(progressSession.ts:214,章首重置)不受影响。
- 行为零新增(捕获仍是点击瞬间视口,T10 原样):改动纯 CSS,reading.test.tsx
  既有断言零改写红线照旧;每 commit 门禁 typecheck && test && lint 绿
  (看退出码,不看 tail)。

**Blocked by:** 无(01/02/03 均 done)

- [x] .reading-top 吸顶 + 吸顶态背景/边框 + z-index 协调(lookup-popup 仍压栏上)
- [x] scroll-padding-top 配套(自动恢复/书签跳转目标块不被吸顶栏遮挡)
- [x] 浏览器验收:真滚动到章节深位 → **原位**点「打书签」→ 面板条目前缀 =
      深位块原文(非章首);书签跳转/自动恢复落块不被顶栏遮住;截图记 Comments

## Comments

> *Decision record from /grill-with-docs, 2026-11-01。维护者拍板「吸顶,落 spec 和票 04」。*

重开背景与候选判定:

- **根修法 = 吸顶工具栏**:唯一同时解可达性(四按钮全常驻)与捕获语义
  (T10 一字不用改)的候选。
- **面板内打点撤销独立候选资格**:双轴失效——「目录」开启器与打书签同在
  顶栏,章中同样够不到面板;滚动先于开面板发生,grilling Comment 预留的
  「面板关闭态视口」语义救不了落章首(敌人是那一步滚动,不是面板开合)。
  且现几何下面板是 absolute 覆盖层(style.css:148,不挤压正文),
  topmostVisibleBlock(readingProgress.ts:50)面板开闭同值——该语义本就
  自动成立,无须写进规则。
- **FAB 悬浮按钮出局**:新浮动物种(全应用唯一浮动件是 lookup-popup),
  且只救打点一个按钮,目录/显示设置/翻译仍不可达。
- **维持现状出局**:深层打点总落章首,书签退化为「章首标记」,与目录功能
  重复——书签的特色恰是块级深位。
- **形态 = 整行吸顶**:拒滚动感知瘦身条(IntersectionObserver + 两态渲染 +
  闪烁防护 + 成倍测试面,买不回一行空间);sticky → 瘦身条将来可平滑升级。
- **载体 = spec 决策 8 增子句 + 本票 + 票 03 记拍板一行**;不开 ADR
  (CSS 级可逆,spec + 票即承载),不进 GLOSSARY(吸顶是 UI 行为,非领域词)。

> *Wrap-up, 2026-11-01 (/implement, Claude)。*

**红绿证据**

- 基线 = `28f8dc0`(本票首个实现 commit 之前的 HEAD);实现 3 commit:
  `cd0aba4` 吸顶(sticky + 页面色背景 + 底边框 + z-index 5 +
  scroll-padding 3.5rem)→ `b2cb3dd` 验收修复(scroll-padding 3.5rem→4rem:
  栏实测 59.4px ≈ 3.71rem,56px 差 3px 让目标块首行钻栏下)→ `ec2ef98`
  评审修复(style-locality 四钉平台主张)。每 commit 门禁 typecheck &&
  test && lint 退出码 0(pre-commit 钩子重跑全量;`ec2ef98` 首提被钩子
  当场拦下 TS2345 少 `!`,补后过——「看退出码不看 tail」活例)。
- jsdom 侧零新增行为断言(纯 CSS 无布局可测):reading.test.tsx 52 测试
  既有断言零改写全绿;style-locality 3 测试(新增第四枚只钉声明值)。

**浏览器验收(真滚动深位 → 原位打点 → 跳转/恢复/回章首,9/9 PASS,EXIT=0)**

- 真实 Chromium + 生产构建(:3789,scratch DB):导入 md 两章书(50 句/章,
  句号进前 20 字保证前缀判别)→ DOM 滚动块 32 顶边到视口 0 → 原位点
  「打书签」→ 条目前缀「Chapter One · Sentence 032 of chap…」(深位,
  非章首)→ 点击全程 scrollY=1937 不变(刺激完整断言);栏钉视口顶
  (y=0)、按钮 y≈1.6 常驻可达;块 45 起跳点条目 → 块 32 落 64.45px
  (栏底 59.39px,余量 5px)→ 重载自动恢复同落点 → 回到第一章落 64.45px
  → 查词弹窗 z=20 压栏 z=5。截图 4 张(/tmp/pw-e2e/04-*.png,会话临时
  目录;04-deep-mark 可见面板随栏吸起 + 条目深位前缀)。
- 验收过程抓到测试方法论坑(已沉淀 docs/agents/browser-e2e.md §3):
  playwright locator.click() 的 pre-click 自动滚动在 actionability 窗口
  内即可注入,「目标在视」防不住(按钮钉 y≈1.6 仍被滚,三早轮捕获读
  017/023/24 全是它冲的;仪器化定位滚动发生在点击派发前);视口敏感捕获
  一律 DOM 级点击 + scrollY 刺激完整断言。
- **记档不修(T10 精度 nuance)**:topmostVisibleBlock 取「顶缘骑跨视口」
  的块,吸顶后该块常在栏下不可见——读者感知的当前行是栏下第一块,深位
  捕获至多偏 1–2 块(章首缺陷已解,量级不变);改「bottom > 栏底」是
  T10 语义变更,超出本票「行为零新增」包络,候选留作未来 spec 决策。

**双轴评审判定(基线 28f8dc0,双 agent 并行,引文已逐字 grep 核对)**

- Spec 轴 PASS:票面五要素逐项落实、无缺失无蔓延无错误实现;
  window.scrollTo(0,0)(progressSession.ts:214)不走 scroll-into-view
  对齐故不受 scroll-padding 影响,与票面一致;面板随栏吸起无需改 CSS
  (sticky 保持 .reading-top positioned,.header-panel 锚定不变)。
  非阻塞观察:1px 底边框 rest 态也常驻(纯 CSS 无法只样式化吸顶态)
  ——拍板记录拒瘦身条的固有代价,与决策一致,记档不修。
- Standards 轴零硬违规,3 judgement call:①「断言钉所声称属性」→ 已修
  (ec2ef98);②栏高知识双处存放 → 随①双账本同修;③色值字面量循本文件
  裸 hex 习法 → 记档不修。

**Spec 漂移**:无。
