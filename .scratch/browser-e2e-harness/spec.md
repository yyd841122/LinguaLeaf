# Web 浏览器验收骨架——视口刺激纪律进代码

Status: done

来源:/retro 2026-11-01(reading-bookmarks 04 session)。证据链:03 票验收烧
一轮(click 自动滚动污染点击瞬间捕获,写入 browser-e2e.md §3 警告)→ 04 票
**带着警告在上下文里**仍烧三轮(捕获读 017/023/24,playwright 在
actionability 窗口注入 pre-click 滚动)+ 一轮脚本自身花屏。根因:刺激纪律
存成了警告文字,每次验收现推;本票把它落成代码,此后验收 = 扩模板而非
重踩坑。

**What to build:**

- 根目录 `scripts/browser-e2e/` 提交最小骨架,一条 npm 脚本可跑:
  - playwright-core 进根 devDependencies(纯驱动,零浏览器下载);
    executablePath 探测 `~/.cache/ms-playwright/chromium-*/` 缓存,
    launch 带 `--no-proxy-server`(本地 E2E 代理坑)。
  - **刺激完整助手**(本票核心):视口敏感的点击一律 DOM 级
    (`locator.evaluate((el) => el.click())`),助手内建「点击前后
    scrollY 不变」断言——locator.click() 的 pre-click 自动滚动在
    actionability 窗口内即可注入,目标在视也防不住(04 票实证)。
  - fixture 生成器:md 两章书,句子带零填充编号且编号进**前 20 字**
    (条目前缀 ≤20 字截断,编号不进前 20 字则深位前缀与章首不可判别,
    04 票 fixture 教训)。
  - 服务器纪律循 browser-e2e.md 现配方:先 `fuser -k` 免孤儿端口、
    scratch DB(不碰用户 .data)、按 PID 杀;dist 新于源码时免
    rebuild 重启(04 票迭代每轮全量 build 是纯浪费)。
- **验收示例即回归钉**:模板的 worked example = reading-bookmarks 04 的
  9 断言场景(吸顶钉顶/深位原位打点前缀 032/跳转·恢复·回章首落栏底
  5px 余量/弹窗 z20 压栏 z5),跑绿即证明骨架可用,顺带把 04 的验收
  从会话临时目录变成可重放的仓库资产。
- `docs/agents/browser-e2e.md` §3 瘦身:03 的警告段 + 04 的精炼段收缩为
  指向模板的 pointer(Why 进模板注释)——单一事实源,文档不再复述代码
  已承载的东西。

**明确排除:**

- 不进 pre-commit / verify 门禁(需构建产物 + chromium,按票手动跑);
  不做 CI;不追求多浏览器;扩展端 smoke 骨架不动(它已 CDP 直连、
  零依赖,是另一套已工作的东西)。

**Blocked by:** 无

- [x] `scripts/browser-e2e/` 骨架 + npm 脚本 + 根 devDependency
- [x] 刺激完整助手 + fixture 生成器 + 服务器纪律四件齐
- [x] worked example(04 九断言)从净态跑绿,截图与断言输出可复现
- [x] browser-e2e.md §3 瘦身成 pointer
- [x] 每 commit 门禁 typecheck && test && lint 绿(看退出码,不看 tail)

## Comments

> *Created by /retro, 2026-11-01。维护者拍板「接受建议」。*

retro 判定记录:01–04 全 done 后环境体检通过(门禁/导航/记忆/评审生态
零 finding),唯一高严重度候选即本票——视口敏感验收的刺激纪律在 03/04
两票连续烧了四轮,警告文字形式不迁移进执行;机械化 = 骨架内建助手,
坑在代码层不可达。

> *Wrap-up, 2026-11-01 (/implement, Claude)。*

**红绿证据**

- 基线 = `f44be61`(本票首个实现 commit 之前的 HEAD);实现 2 commit:
  `174ead0` 骨架+worked example+docs 指针 → `241b754` 双轴评审修复。
  每 commit 门禁(pre-commit 钩子全量重跑)typecheck && test && lint &&
  三个 locality gate 退出码 0;测试 517 枚(46 文件,含 harness 单测 12)。
- 浏览器验收:worked example 从净态(scratch DB 每轮清空重建)跑绿,
  台账 12 枚 = 编号九断言 + fixture 导入准备 + 7a 落点已存前提 +
  无未捕获页错卫生,数值逐项对上 04 验收记录:栏底 59.39px、按钮
  y=1.6、点击全程 scrollY=1937 不变、条目「Chapter One · Sentence 032
  of chap…」、跳转/恢复/回章首落点 64.45px 余量 5.06px、重载同落点、
  弹窗 z20 压栏 z5。稳定性 3/3 连绿;截图 3 张
  (/tmp/lingualeaf-browser-e2e/reading-bookmarks-04/04-*.png)。
- dist 新鲜度两向实测:新鲜轮次打「skipping build」;touch
  style.css 后下轮打「stale — running npm run build」全量重建后九断言
  仍绿。
- 单测缝(12 枚,入根 vitest 项目):fixture 契约(编号进前 20 字逐句
  钉/单段单句无 sbd 陷阱/确定性)+ freshness 判定(缺 dist→stale、
  dist 新→fresh、任一源新→stale)。票面排除项读法:排除的是浏览器
  验收跑(需构建产物+chromium,按票手动);纯逻辑不走 chromium,随
  正常门禁跑——评审 Spec 轴复核认定不触「不进门禁」排除。

**搭骨架时抓到、已沉淀进模板的坑(下次验收 = 助手已内建,无需再踩)**

1. 章尾块到不了视口顶:阅读页一次只渲染一章,块 45(50 句/章)下方
   仅 ~280px,顶边滚动只会钳在 max——`scrollBlockIntoView` 在视刺激
   (内建「完全在视」断言)补 `scrollBlockToViewportTop` 的适用域。
2. 跳转类点击的 handler 自己 scrollIntoView 是被测行为:scrollY 不变
   断言只属「点击瞬间读视口」的点击(打书签/查词/开面板),跳转由
   落点验证——`handlerMayScroll` 豁免,豁免语义写进助手注释。
3. 跳转的 scroll 事件下一帧才送达:紧随其后的弹窗刺激(scroll 即自
   灭)可能装上又拆掉,快过 waitForSelector 轮询——实测抓到一轮 A9
   超时;`waitForScrollSettle`(init 脚本记时间戳,盖 reload)+ 350ms
   静默窗,接在 handlerMayScroll 点击与下一视口敏感刺激之间。
4. 固定端口单跑:两个 harness 实例并行会互杀对方的 server
   (EADDRINUSE 快速失败并指到 server.log,纪律如设计工作——实测
   发生在 Spec 评审跑验证与本会话运行相撞时);并发注意事项已写入
   startAppServer 注释。

**双轴评审判定(基线 f44be61,双 agent 并行,引文已逐字 grep 核对)**

- Spec 轴 PASS:票面四要素+两个 pointer 逐项落实、无缺失无错误实现;
  评审自行重跑 worked example 全绿(EXIT=0)。非阻塞 nuance 记档:
  「5px 余量」断为 4–12px 带宽而非钉死 5px——字体环境容差换稳定性,
  实测值每轮打印(本轮 5.06px),上界仍抓 scroll-padding 漂移;scope
  creep 四项(单测缝接线/--no-sandbox/CHROME_EXE 覆盖与滚动助手双生/
  eslint 双界块+Setup 指针段)均低severity且已在 commit message 披露。
- Standards 轴 1 硬违规 4 judgement call:硬项「编排器 try/finally
  未罩住 startAppServer/launchBrowser——启动中段失败漏孤儿」已修
  (241b754,server/browser 可空收尾);judgement call 修三(tmp 脚手
  架 ×5 抽 withTempDir;ENTRY_PREFIX_MAX_CHARS 双账本源码侧 regex 钉,
  循 ec2ef98 scroll-padding 先例;块选择器三处收敛 blockLocator+导出
  blockTop,b2e- 前缀替 bimtest),记档不修二(fixture 故意干净——其
  职责是确定性块索引非 import 健壮性;harness 六关注点同文件系票面
  「最小骨架」本意)。

**Spec 漂移**:无。

**需要人做的事**:票面五 checklist 已全勾,无遗留人工检查点。使用
纪律提醒:浏览器验收从此走 `npm run browser-e2e`(按票手动跑,不进
门禁/CI);端口固定 3789 单跑,勿并行两个实例。
