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
- 2026-11-15 真机 round 1 记录:①APK 未部署即测——picker 不认 .md;按 README
  出包流程(vite build → cap:sync → gradlew assembleDebug → adb install -r,
  数据保留)后可选中。②新书切章落章中段/末尾、顶部疑「与第 1 页重复」——诊断
  (playwright 双臂环,回归场景 scripts/browser-e2e/mobile-md-chapter-scroll.mjs
  npm run browser-e2e:mobile):goChapter 未重置 window 滚动(面级洞,非 md 专属;
  短章钳制掩盖),已修(commit 见 git log fix(mobile) 章切换重置);「重复」实为
  原书第 1 章导语与第 2 章开头同有的韭菜定义段,存储书零跨章重复,数据忠实。
  真机书《韭菜的自我修养》预检:35 章/1209 句块,两个预期怪相(章 1 头部 TOC
  raw 块挤成一行;「Appendix」空章)均为 web 同款语义。③web 面同型洞立候选票
  .scratch/web-reading-chapter-scroll-reset/spec.md(needs-triage)。
- 2026-11-15 真机 round 2+3:35 章书把内联 reader-toc 变成每页一屏高的条。
  round 2 先按维护者指令改「只在第一章渲染」;round 3 维护者改拍板为「页头
  目录按钮 + 浮层选章」(commits 3479aea、3c5a7bb)——章列表收进浮层壳(照
  书签浮层),所有章统一入口,当前章 aria-current,跳章继承脏草稿守卫;内联
  nav 移除。8 处既有测试点击前置开浮层,3 处 aria-current 断言改读页码
  span(脏草稿场景开浮层会误触放弃确认)。5 套件 97 绿,浏览器滚动场景全绿。
- 2026-11-15 真机 round 4:导航词形收口——工具条「打开」实为回书架,标签
  无导航语义,正名「返回」(动作不变,不加重复按钮;PDF 面「打开」按用户
  点名范围不动);目录浮层头部加「返回」(35 章列表把底部关闭顶到折叠线下,
  退出不依赖滚动)。12 处测试查询同步(commit 0d524bd)。5 套件 97 绿。
- 状态维持 ready-for-human:剩余人检点不变——caller `npm run verify` + 真机
  6 步(切章断言按 round 1 修复后行为:落章首;章导航按 round 3:目录浮层)。
