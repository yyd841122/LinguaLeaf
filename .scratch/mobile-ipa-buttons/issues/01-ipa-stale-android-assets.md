# 01 — 音标不显示：Android 内置资产陈旧（丢失内核共享样式）

Status: done

## 现象

更新后的 APK：点击「音标」开关，正文永远不出现音标（开关本身生效，
但没有任何可见变化）。

## 根因（已实证）

- 音标字形只由内核共享样式表的 `.ipa-word-ipa::before {
  content: attr(data-ipa) }` 绘制（span 本体为空）。
- 849dbba 把调色板 `:root` 块放到 `@import` 之前，postcss-import 静默
  丢弃整份内核共享表 → 构建 CSS 失去 IPA/弹窗定位/译文行等全部规则。
- dd6045d 已修位序并重建 `apps/mobile/dist`（实证：dist CSS 含
  `content:attr(data-ipa)`，真浏览器 412px 双深浅色验证 23/23 词带
  data-ipa、开关两次翻转均正常）。
- **但 `npm run cap:sync` 从未重跑**：`android/app/src/main/assets/
  public/assets/index-DY-rS_U_.css` 仍是坏产物（`grep -c
  'content:attr(data-ipa)'` = 0；`.translation-line`、`.code-block`
  同样缺失），APK 由它打包 → 真机症状。

## 修法

1. 源码零改动（已健康）。
2. 实现票 02 的源改动后统一 `npm run build && npm run cap:sync`，
   让内置资产吃到含两修复的新产物。
3. 静态守卫：touchPolish 增「构建产物完整性」钉——dist 与 android
  内置资产里的每份 CSS（存在时）必须含内核标记
  `content:attr(data-ipa)`，防止下次 cap-sync 漏跑/坏产物再次上机。

## 验收门

- android 内置资产 CSS 含 `content:attr(data-ipa)`（grep 实证）。
- 新守卫测试绿；守卫咬合（评审修正后的口径，原「删掉 dist 须红」
  过度——fresh clone 的 test 步先于根 verify 的 build 步，测试不能
  要求预构建产物在场）：
  - 产物目录在场却无 CSS（半构建）→ 红；
  - 在场 CSS 被剥掉内核标记（本次事故形态）→ 红；
  - 两处目录均不在场 → 跳过。
- 真机重装后点「音标」音标出现/消失（人验，caller）。

## 人验（caller）

- 重装 APK → 打开一本书 → 点「音标」两下：音标消失又出现。

## Comments

**2026-11-16 实现 + 评审闭环（Lane A）**

- 实证链：HEAD dist 含 `content:attr(data-ipa)`（真浏览器 412px 双色
  23/23 词带 data、开关两翻正常）↔ android 资产 `index-DY-rS_U_.css`
  同标记 grep=0（`.translation-line`/`.code-block` 同缺）→ 陈旧 sync
  实锤。`npm run build && cap sync` 后双址均含标记（新产物
  `index-mQpfbtqE.css`）；APK 内 zipfile 复核通过，已装机
  （lastUpdateTime 2026-11-16 20:14）。
- 守卫（touchPolish「built-artifact integrity」）三变异咬合：dist 剥
  标记红 / android 剥标记红（本事故形态）/ 在场无 CSS 目录红；双址
  缺席跳过（fresh-clone 容忍，根 verify 的 build 步在 test 步后）。
- 双轴评审（code-review skill，Standards/Spec 并行）：Spec P1「删 dist
  不红」→ 守卫改每目录口径 + 门面措辞同步修正（原口径过度）；P3 空
  断言删除。已采纳。
- 待人验：真机点「音标」两下（出现/消失）。

**2026-11-16 真机机检（最终 APK,raw CDP,scripts/device-cdp-eval.mjs）**

- 真机 360×748 WebView 打开 The Lighthouse Diary:`.ipa-word-ipa` 375 个
  带 data（样例 ˈɑɡəst），aria-pressed=true；点「音标」off → 0 且
  pressed=false，再点 on → 375 且 pressed=true。开关两翻可见工作。
- 截屏 evidence/device-final-360.png。翻 done。
