# 02: 手机端导入 md 书(与 EPUB 面同权全链)

**Status:** ready-for-human

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
- 2026-11-15 实现:ReaderPage.tsx 零改动(预期成立,无需记理由);extension
  孪生 import-book.ts 零 diff(分叉达成)。改动面 = import-book.ts(谓词放开 +
  md 分支 TextDecoder utf8 + wire 体如实 + unsupported-format 手机语,端词漂移
  顺带修)+ ReaderLanding.tsx(accept/.md/.markdown,可见文案,aria-label)+
  5 个测试文件的 aria-label 查询同步(13 处,计数断言替换)。commits a11938a、
  c8c8cee、d838e4a。readerPage.test 新增 md 三测 + accept 属性钉测,全套件
  107 文件 1184 绿。
- 2026-11-15 Codex read-only 审核(threadId 01a1df75-57b4-7692-94a3-70c3cd998549)
  verdict NO-GO,两项代码级发现当场修(c8c8cee):①正向测止步书架,缺「书架→
  打开→见句子块与 IPA」弧——补书架项重开断言,章 2 夹具加 quiet 使 IPA 断言
  非装饰;②accept 属性无测试钉住(变异心证:回翻旧值全绿)——补 getAttribute
  精确断言。其余 P2(verify/真机无记录)属管线人检点,按序走。
- 2026-11-15 内置双轴 review(ef2188a...HEAD):Spec 轴零缺失零错实现,元素
  语义/文案/依赖迁移逐项对上票面。Standards 轴 4 项 judgement call:2 项当场修
  (d838e4a:fixtureFile 加 type 参数,md 夹具传 text/markdown,不再谎报 MIME;
  TIDE_MD → tideMdFile 工厂更名);1 项立候选票(.scratch/test-picker-label-constant/
  spec.md,picker label 14 处字面量批扫);1 项压制——两宿各自 utf8→text 适配
  是 spec 决策 4 的有意形状(「分发收在 import-book.ts 内」),扩展补 md 与
  孪生去重仍按 spec Out of scope 另票。手机阅读器措辞非 glossary 违规
  (spec 指定文案;GLOSSARY 手机应用 为最近正名,无 Avoid 冲突)。
- 状态翻 ready-for-human:剩两个人工检查点——(1)caller 显式补跑
  `npm run verify`;(2)真机 6 步清单(spec「真机人验清单」,清单第 6 步
  预期文案已是手机语)。两项过后收官 docs commit 翻 done。
