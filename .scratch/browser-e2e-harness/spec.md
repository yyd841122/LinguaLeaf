# Web 浏览器验收骨架——视口刺激纪律进代码

Status: ready-for-agent

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

- [ ] `scripts/browser-e2e/` 骨架 + npm 脚本 + 根 devDependency
- [ ] 刺激完整助手 + fixture 生成器 + 服务器纪律四件齐
- [ ] worked example(04 九断言)从净态跑绿,截图与断言输出可复现
- [ ] browser-e2e.md §3 瘦身成 pointer
- [ ] 每 commit 门禁 typecheck && test && lint 绿(看退出码,不看 tail)

## Comments

> *Created by /retro, 2026-11-01。维护者拍板「接受建议」。*

retro 判定记录:01–04 全 done 后环境体检通过(门禁/导航/记忆/评审生态
零 finding),唯一高严重度候选即本票——视口敏感验收的刺激纪律在 03/04
两票连续烧了四轮,警告文字形式不迁移进执行;机械化 = 骨架内建助手,
坑在代码层不可达。
