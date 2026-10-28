# 07: 整装验收与加载说明

**What to build:** 用户验收路径整装跑通：从零 load-unpacked 加载扩展 → 打开 EPUB → 音标行 → 点词改态 → 重开回位 → 断网复验；PDF 按 06 判定走通；README 交代加载方式、数据自决（卸载即清）与边界。收官前加一道独立 cc-suite 审核门。全仓 lint/typecheck/test 绿收官。

**Blocked by:** 04、05、06

**Status:** ready-for-agent

- [ ] 从零加载到断网复验的完整验收路径走通，记录进本票 ## Comments
- [ ] PDF 路径按 01/06 判定走通
- [ ] README：加载说明、数据自决、边界（扫描版/DRM/超大文件）
- [ ] 全仓 lint、typecheck、test 全绿
- [ ] 独立 cc-suite 审核通过：qwen-review 走查扩展整 diff；qwen_not_found 时按本票降级为 Codex 审查 lane，不得静默跳过；发现项修复或另立 needs-triage 存根票
