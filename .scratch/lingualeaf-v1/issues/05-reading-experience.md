# 05: 阅读体验闭环

**What to build:** 让阅读真正好用：音标行与译文行各有独立显示开关、字号可调（三者均存 localStorage 每设备记忆）；目录面板跳转章节；阅读进度自动保存并在重新打开时恢复；书架可删书。

**Blocked by:** 02 Markdown 导入到句子块阅读（第一条曳光弹）

**Status:** ready-for-agent

- [ ] 两个显示开关独立生效，刷新页面后记忆保持
- [ ] 字号可调节且记忆
- [ ] 目录面板可跳转到任意章节
- [ ] 离开后重新打开，恢复到上次阅读位置（章节 + 块位置）
- [ ] 书架可删除书，删除后列表即时更新
- [ ] 组件缝测试覆盖开关与字号；API 缝测试覆盖进度保存与删书

## Comments

- 2026-10-17 (Claude): 验收票 03 时用户提前要了音标字号调节，已实现（commit 见 03）：`IpaSizeControl` + `useIpaSize`（localStorage `lingualeaf.ipaSize`，每设备记忆）+ `.ipa-word-ipa { font-size: var(--ipa-size) }`。本票的正文字号与两个显示开关请复用同一模式（受控组件 + localStorage hook + CSS 变量），并考虑把音标开关与字号统一进同一设置区。
