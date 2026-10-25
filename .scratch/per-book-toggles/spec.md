# 显示开关与字号按书持久化

来源:旧仓库复盘(2026-10-24),承接 graded-reader ADR-011 决策 1:「不同材料难度不同,
偏好随书保存」。LinguaLeaf 现状:prefs.ts 把两个显示开关(Toggle)+ 三个字号存
localStorage 全局键,换书要手动重调。(复盘时误记两个字号;实现票 01
核对代码为三个,原文行字号一并按书——见票 01 Comments。)


## 已定语义

- 存储键从全局键改为按书键:`book:<id>:<pref>`,读写全走 prefs.ts,调用方传入 bookId。
- 回落:按书键缺失时读旧全局键一次(老用户偏好无缝迁移),旧键只读不写;新书用现有默认值。
- 范围:五个偏好(show-ipa / show-translation / ipa-size / original-size /
  translation-size)全部按书。原文行字号系复盘计数遗漏,实现票 01 补入。

## 门禁

- prefs.ts 的守护语义不变:localStorage 坏死时降级默认值,永不崩渲染。
- `npm run verify` 全绿(看退出码,不看 tail)。
