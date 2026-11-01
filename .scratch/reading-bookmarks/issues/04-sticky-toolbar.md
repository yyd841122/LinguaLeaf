# 04: 顶栏吸顶——深位打点入口常驻可达

Status: ready-for-agent

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

- [ ] .reading-top 吸顶 + 吸顶态背景/边框 + z-index 协调(lookup-popup 仍压栏上)
- [ ] scroll-padding-top 配套(自动恢复/书签跳转目标块不被吸顶栏遮挡)
- [ ] 浏览器验收:真滚动到章节深位 → **原位**点「打书签」→ 面板条目前缀 =
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
