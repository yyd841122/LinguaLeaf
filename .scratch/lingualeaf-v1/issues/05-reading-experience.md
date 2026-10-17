# 05: 阅读体验闭环

**What to build:** 让阅读真正好用：音标行与译文行各有独立显示开关、字号可调（三者均存 localStorage 每设备记忆）；目录面板跳转章节；阅读进度自动保存并在重新打开时恢复；书架可删书。

**Blocked by:** 02 Markdown 导入到句子块阅读（第一条曳光弹）

**Status:** resolved

- [x] 两个显示开关独立生效，刷新页面后记忆保持
- [x] 字号可调节且记忆
- [x] 目录面板可跳转到任意章节
- [x] 离开后重新打开，恢复到上次阅读位置（章节 + 块位置）
- [x] 书架可删除书，删除后列表即时更新
- [x] 组件缝测试覆盖开关与字号；API 缝测试覆盖进度保存与删书

## Comments

- 2026-10-17 (Claude): 实现。**设置区**：票 03 的 IpaSizeControl 模式泛化——`prefs.ts`（`useStoredNumber/useStoredBoolean`，全部 try/catch 降级，坏值回默认）；`SizeStepper` 通用步进器；`ReadingSettings.tsx` 统一四个控件（音标行开关、译文行开关、音标字号、原文字号），受控组件 + localStorage hook + CSS 变量（`--ipa-size`、`--original-size`，14–28px 默认 18；按 GLOSSARY 用「原文」不用避用词「正文」）。`ReadingView` 按 `showIpa/showTranslation` 条件渲染标注行，原文行永不可藏；IPA 隐藏时逐词配对单元一并消失、原文按纯文本渲染。**目录**：页头「目录」下拉面板列全部章节（按 level 缩进，`aria-current` 标当前章），点击即跳。**进度**：服务端存（票要求 API 缝覆盖）——`reading_progress` 表（book 主键，随书级联删），`GET/PUT /api/books/:id/progress`；书架列表 LEFT JOIN 带出进度，书籍链接直达所存章节；阅读页打开时恢复 `scrollIntoView` 到所存块（250ms 滚动守卫防恢复滚动被当成阅读），阅读时滚动追踪最顶可见块、500ms 防抖 PUT，翻章/卸载/pagehide 立即 flush（keepalive）。**删书**：`DELETE /api/books/:id`（FK 级联 chapters/blocks/progress），书架确认后原地过滤列表。
- 2026-10-17 (Claude): code-review(Standards+Spec 双轴)后修复：① `fetchReadingProgress` 只把 404 当「从未读过」，网络/5xx 上抛，页面把进度态记为 unavailable——此时不自动保存章首，防止一次瞬时故障把真实进度覆盖成 block 1（新增 404/503 分野测试）；② books-router 四处 `Number(params.id)`+404 收敛为 `bookFromParams`；③ ReadingView `paired` 拆成 `slotPaired`（数据事实）与可见性（开关事实）；④ BookshelfPage 复用 `ReadingProgress` 类型；⑤ 测试 `importSampleBook` 去重为模块级共享。复核后不改：value/onChange 成对 props（沿用受控步进器既有惯例）、`topmostVisibleBlock` 按 class 定位（渲染内幕不搬进进度模块）、字号 pref 再抽象（两实例属投机通用性）、越界章节不校验（仅损坏数据可达，客户端自愈回书架）。范围外加了两处小件：书架显示「读到第 N 章」、删书前 `window.confirm`（防误删重导要花翻译费）。
- 2026-10-17 (Claude): 门禁全绿（退出码已验）：typecheck、77/77 测试（组件缝 16 + API 缝 22 + 其余原有）、lint、build；另用编译版 server + 临时库冒烟（`--noproxy`，空 key 不打真翻译）：导入→PUT/GET 进度→400 校验→删除 204→重复删 404→SPA fallback 全通。**人工验收**：浏览器里过剩余三框——目录跳章、离开后重开恢复位置（书架点书直达章节并滚到块）、删书后列表即时更新；顺带确认开关/字号刷新页面后记忆保持。

- 2026-10-17 (Claude): 验收票 03 时用户提前要了音标字号调节，已实现（commit 见 03）：`IpaSizeControl` + `useIpaSize`（localStorage `lingualeaf.ipaSize`，每设备记忆）+ `.ipa-word-ipa { font-size: var(--ipa-size) }`。本票的正文字号与两个显示开关请复用同一模式（受控组件 + localStorage hook + CSS 变量），并考虑把音标开关与字号统一进同一设置区。
- 2026-10-17 (yyd841122): 人工验收通过 —— 显示开关/字号刷新后记忆保持、目录跳章、离开后重开恢复位置、删书即时更新，全部实测通过。
