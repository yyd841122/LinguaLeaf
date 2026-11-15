# 02: 手机端导入 md 书(与 EPUB 面同权全链)

**Status:** ready-for-agent

**What to build:** 手机书架的导入按钮选中 `.md` 文件,得到与 EPUB 书逐项同权的完整链:
进书架、导入时离线词典注音、点词查详情(首次查词进生词本)、按章「翻译」按钮、
阅读进度/书签/笔记照常;标题分章,元素语义与 web md 完全一致(spec 决策 5,零特殊化)。
选择器 accept 与三处用户文案换成三格式,顺带修掉「扩展阅读页」端词漂移。真机按
spec 的 6 步白话清单走通即为完成。

**Blocked by:** 01(md 解析器下沉 import-core —— mobile 只能从 import-core 引解析器,
真门非仪式依赖)。

**验收门**(对应 spec 验收 b、c):

- [ ] mobile 单测:md File 导入 → 书架项出现 → 打开见句子块与 IPA 槽
- [ ] mobile 单测:不支持扩展名仍 unsupported-format 且文案正确(手机语、含 Markdown);
      同书名重导的替换确认(DocumentReplacementRequired)对 md 书同样生效
- [ ] accept 扩为三格式;可见文案、aria-label 按 spec 决策 2 的新文案落地
- [ ] 真机人验 6 步全过(spec「真机人验清单」)——人工检查点
- [ ] caller 显式补跑 `npm run verify`(退出码不等于 verify 门)——人工检查点

## Comments

- 2026-11-15 自 spec 拆票。ReaderPage 分流预期零改动;若实现中发现必须动,
  在此记理由。
