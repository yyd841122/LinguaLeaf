# 03 — 查词弹窗生词本状态钮恢复小尺寸

Status: done

## 现象

用户（2026-11-16 round 3）：查词弹窗里生词本那排按钮（学习中/已掌握/
已忽略）变大了，要求恢复之前的小样式。

## 根因

票 06 的全局触控底线（style.css `button { min-height: 44px }`）把弹窗
状态药丸从 ~20px 顶到 44px——真机实测（360×748 WebView，点开
"August" 弹窗）：三钮各 44×56px、整排 52px、弹窗 237px 高。药丸本有
0.8rem 紧凑样式（reader.css `.lookup-vocab-option`），底线在其上叠乘。

## 修法

`.lookup-vocab-option` 域内豁免底线（笔钮/听书行同款第三例）：
`min-height: 0` + `position: relative`，纵向-only `::after` 外扩
（`inset: -0.35em 0`）补偿点击区（视觉 20px、命中 ~29px）；横向不外
扩——行内 gap 仅 0.25rem，横向外扩会让相邻药丸命中区互相压叠。
弹窗头部「发音/关闭」未在用户点名范围，维持底线尺寸。

## 验收

- 真机（build+sync+install 后，raw CDP 复测）：三钮 h=44→20、整排
  52→30、弹窗 237→215；截图 evidence/popup-vocab-after-360.png。
- touchPolish 静态钉（豁免+纵向-only 命中区；横向零外扩有意钉死），
  变异咬合（min-height 篡改 → 红）。
- 根 npm test 112 文件 1268 过 | 3 skipped。
