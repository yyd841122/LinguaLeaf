# 01 主题与令牌基座
Status: ready-for-human(2026-11-16 实现完毕,待 Codex 审核与 verify 补跑;见 ## Comments)

## 目标

改版的视觉地基:令牌换血 + 手动主题机制,先行独立可验,后续票只消费令牌不碰色值。

## 范围

- `reader.css` 17 个颜色 token 换血:accent 紫 `#6a4fa3` → 砖红 `#c5322a`;暖纸三主题全套;夜间重映射(砖红提亮到可读,具体值实现时调);音标紫退役 → 暖灰
- 新增间距·字号·圆角尺度令牌(4px 基),供后续票消费
- 手动主题机制:暖纸 | 白 | 夜间 | 跟随系统,存 `ui-settings`(store version 1 → 2 迁移;随迁移退役 `pdfToolbar` 项——02 票撤其 UI);暖纸为默认亮色;夜间沿用现有 dark token 面
- kernel 共享表面继续 app 侧覆盖隔离(06 票先例),kernel 不动

## 验收门

- 三主题 + 跟随系统在 EPUB / PDF / 书架 / 弹窗全面生效
- token 单一事实源:app 内无散落硬编码色值
- 旧 `ui-settings` 记录(version 1)迁移不丢、不炸;PDF 原版 canvas 纸面恒白不受主题影响(「纸就是纸」延续)

## Comments

- 2026-11-16 Lane A 实现完毕(单 commit,基线 = 本票首个实现 commit 的
  HEAD 之前)。要点与拍板:
  - **令牌换血**:`reader.css` 三主题块(暖纸 = 裸 `:root` 默认亮色;
    白/夜间经 `<html data-theme>`)。暖纸底 `#f6f5f1` 照参照图;accent
    `#c5322a`(白/暖纸同值);夜间沿用 06 票暗面 token,仅 accent 提亮
    `#e5705f`(对比度:暗纸 5.40 / 暗卡 5.05;`#c5322a` 在暗地仅 ~3 不可
    读),`--accent-fill` 夜间保留砖红本色。四态绿系、danger 原值保留。
  - **音标紫退役**:kernel 表钉的 `#6a4fa3`(ipa-line / ipa-word-ipa)
    由 app 侧无条件覆写为 `var(--muted)` 暖灰(原只暗色覆写,现全主题);
    PDF 原版音标 chip 的墨色走页锚 token `--pdf-ipa-ink`(chip 落在恒白
    纸面上,不能跟主题灰走)。`#6a4fa3` 已从 app 内清零(静态测钉死)。
  - **手动主题机制**:偏好存 ui-settings v2(`paper|white|night|system`),
    v1 迁移退役 `pdfToolbar`(值弃,不炸不丢——v1 记录读作合法 v2 默认,
    下次保存整写为 v2)。**默认 = 跟随系统**(票面「暖纸为默认亮色」解读
    为:系统亮色落在暖纸;默认偏好取 system 以免 06 票的暗色跟随用户升
    级即被闪回亮纸)。解析在 JS(resolveTheme + matchMedia 监听),CSS
    不留 `prefers-color-scheme` 块与手动档打架;`color-scheme` 随主题块
    声明,`style.css` 不再声明(打包序 style.css 在 reader.css 之后,留
    着会盖住手动主题——已记入该文件头注释)。机制经 `useThemePreference`
    挂在 ReaderPage(= 整个 app),书架/EPUB/PDF/弹窗同源生效;选择 UI
    归 02 票 Aa 面板。
  - **单一事实源**:hex/rgba 只许出现在 token 声明;`gray`/`canvas` 关键
    字清零;新增 `--scrim`/`--shadow-color` 主题档与页锚组
    (`--pdf-page-paper` 等,主题块不得重声明——静态测钉死)。散落阴影
    (#0003、绿调 rgba 阴影)统一走 `--shadow-color`。
  - **PDF 纸面恒白**:pdf.js 本就填白页;`.pdf-stage canvas` 显式钉
    `var(--pdf-page-paper)`(不随主题),原版覆层(词悬停/音标 chip)全
    部页锚。重排面走主题 token(书外壳暗、重排版面暗)。
  - **尺度令牌**:4px 基 `--space-1..6`/`--text-xs..xl`/`--radius-s..l`
    落 `:root`,后续票消费。
  - **过渡态**:置底/置顶钮仍在(UI 撤除归 02),但偏好不再持久化——
    会话内 state(pdfReflow round-14 测试已按此改写:翻页内生效、重开回
    默认)。
  - **发现(非本票面)**:`style.css` 的 `body{font-family:system-ui}` 在
    打包序里盖过 `reader.css` 的 Georgia serif——今日真机一直是无衬线,
    reader.css 的 serif 声明是死规则。未动(不属本票),02 票排版细则可
    顺手收口。
- 验证:mobile 44 文件 439 过 1 skip;根 `npm test` 113 文件 1283 过
  3 skip,EXIT=0;tsc/eslint(mobile)零告警。静态新增「theme tokens
  (redesign 01)」套件 7 测(三块全量、砖红换血、紫清零、无散落色值、
  页锚恒白、尺度令牌、kernel 无条件覆写);theme.test.tsx 5 测(解析真
  值表 + 挂载应用 + 跟随系统翻转 + 钉住后停跟 + 无 matchMedia 兜底);
  uiSettingsStore 5 测(v1 迁移不丢不炸/降级/往返)。
- 待办( caller):Lane A Codex 审核 → verify 补跑;真机四主题截图入档
  归 P1 出口票(04)。
- 2026-11-16 双轴评审(/implement 内置,Standards/Spec 并行子代理):
  - Standards:1 硬——theme 测「钉住后停跟」半句无探针(变异「钉住仍
    跟系统」全绿过),已补 `media.flip(true)` 后钉住断言;4 判——
    theme.ts 手写 cancelled 旗(非 settle channel)已补裁决注释并删死
    `.catch`(load 内部降级永不 reject)、两处悬浮 `expect().resolves`
    已 await、storage() 与 storedBag() 双胞胎已并、EpubReader 遗留
    uiSettings 注释已清;过渡态置底/置顶会话 state 双胞胎保留(注释
    已写明 02 票整体撤除,到期即删)。
  - Spec:判 compliant,无缺项;唯一待人工拍板——**默认偏好取
    「跟随系统」**(票面「暖纸为默认亮色」解读为系统亮色落暖纸;若按
    字面取暖纸为默认值,06 票的暗色跟随用户升级即被闪回亮纸)。已知
    副作用:存了夜间的用户冷启首帧为暖纸(JS 解析前 :root 默认),
    属机制固有,真机观感归 04 票机检。收官时请维护者对此拍板确认。
  - 修笔后复验:theme/uiSettings 10 测过,tsc+eslint 零告警,全量
    见收官 verify 补跑。
