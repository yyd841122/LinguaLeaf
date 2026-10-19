# 标注书文件：内嵌词义、点词查详情与发音

Status: ready-for-agent

Spec: `.scratch/annotated-book-export/spec.md`

Depends on: 01

## Scope

- 导出时收集本书去重词汇：键 = 与点词查详情同一规范化规则的词面形（大小写、弯引号归一），
  值 = 复用服务端 lookup 逻辑的结果或 null（查不到的词也内嵌 null）；只嵌本书句子块词汇，
  不整库内嵌、不直查 ECDICT 绕过现有规范化
- 文件内点词查详情：分词正则与 `apps/server/src/dict/ipa-line.ts` 保持一致
  （留注释注明与 ReadingView 副本同步的先例）；点词弹窗展示音标/词性/释义，
  查不到的词提示无结果
- 发音：Web Speech API `speechSynthesis`，失败静默不报错

## Acceptance

- 种子书导出后，jsdom 点词弹窗内容断言：命中词展示音标/词性/释义；
  词形变化词（复数/时态）命中词元词条；弯引号/大小写变体命中同一词条；生僻词提示无结果
- 内嵌词汇表键集合 == 本书句子块词汇的规范化去重集合（含查不到词的 null 值；不夹带整库）
- 词典查不到的词：音标行留空跳过（沿现状），不影响整句展示

## Comments

- 2026-10-19 (Claude): 实现。**内嵌词汇表**：生成器单遍收集——`collectVocabulary` 走 `loadBook` 的句子块，逐 token 经共享 `WORD_PATTERN`（`dict/ipa-line.ts` 直接导入，非副本）枚举，键 = `normalizeLookupToken`（与点词查详情同一规范化），值 = 复用 `lookupWord` 的结果或 null（Map 去重，阅读序确定性；不直查 ECDICT、不整库内嵌，zebra/go 等库内词不在书即不在键集——测试钉住）。**JSON 通道**：`<script id="annotated-vocab" type="application/json">`，序列化把全部 `<` 改写为 `\u003c` 六字符转义（JSON 字符串内对 JSON.parse 等价，故书内容/词典释义中的 `</script>` 无法提前闭合标签）；对抗测试用毒词条（translation 含活脚本标签）走词汇通道 + live jsdom 执行，金丝雀未置位、脚本数不变、弹窗 textContent 渲染为纯文本。**点词弹窗**：文件内实现镜像应用 WordLookupPopup（类名/锚定夹紧算术/关闭语义逐一同步）：data-word 委托点按 → `lookupKey`（normalizeLookupToken 的忠实副本，注释写明 keep-identical；弯引号在文件脚本里按 `\u2019` 转义书写防转码漂移）→ 词汇表命中显 IPA/词性/释义 + 原形徽标（IPA 用词面形自身，/bʊks/ 非 /bʊk/），未命中显「词库中未收录这个词。」且各释义行隐藏；行外点击/Esc/✕ 关闭，点另一词移动不关闭，popup 内点击不触发行外规则；`Object.prototype.hasOwnProperty` 守卫 "constructor" 类键。**分词正则一致性的落地方式**（票面要求"与 ipa-line.ts 保持一致 + 留注释"）：本文件不需要运行时分词副本——所有可点词在导出时已由共享 WORD_PATTERN 包好 span（比同步副本更强）；文件脚本唯一持有的是 lookupKey 折叠副本（带 keep-identical 注释），点击路径沿 ReadingView 的 data-word 先例。**发音**：speechSynthesis 镜像应用 speakWord——API 缺失/不完整静默返回，先 cancel 再 speak，读点击词面形、lang en-US；mock 断言调用形状，无 API 环境点击不抛。**测试**（export.test.ts 12→18，全套 135/135）：词汇键集 == 渲染词面形折叠去重集（含 null、无整库夹带）、wrote 词条/gupta·the null 点断言、lookup-book 夹具（books/Books 大小写、don't 弯/直引号、zqxjkw 未命中）、弹窗命中/未命中/关闭/移动、发音 mock 与静默、两脚本红线（1 JSON + 1 可执行、无 src/url()/@import/网络调用）。**发现的坑**：jsdom 选择器引擎把属性值大小写折叠（`[data-word="Books"]` 会命中 "books" span）——测试统一用 getAttribute 过滤（真实运行时不受影响）。**门禁**（退出码已验）：`npm run verify` exit 0（typecheck + 135/135 + lint + build）；pre-commit 钩子 prettier + 全套测试绿。**code-review 双轴**：Standards 无硬违规，5 条判断性发现——4 条已修（测试 clickWord 助手去重×4、anchorPopup 魔数具名 + 与应用 POPUP_* 常量及 .lookup-* CSS 的 three-sites-move-together 警示、TOGGLE_SCRIPT→FILE_SCRIPT 改名、spokenWord 声明就近化），1 条接受现状（折叠副本由注释+变体测试守护）；Spec 逐条验收全绿、无缺失无功能缺陷，轻微越界（弹窗关闭/aria 打磨）判定为良性——镜像声明的 UX 参照物。**记录在案**：内嵌 JSON 损坏时弹窗按「未收录」呈现（代码注释披露，离线文件可接受，与应用三态设计有意的语义收敛）；`data-word` 属性未转义系票 01 既有行为，因 WORD_PATTERN 只含字母/撇号/连字符而构造性安全。本票无 Review Gate 条目（qwen-review 系票 01 专项），未运行。**人工验收提示**：本票无强制人工步骤；真实发声、布局对齐、file:// 行为按规格留给票 03 真机冒烟——票 03 收尾清单请包含：点词弹窗（命中/生僻词两态）、🔊 真实出声、双开关、断网双击打开。
