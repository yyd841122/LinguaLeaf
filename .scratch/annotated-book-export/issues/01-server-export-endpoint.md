# 导出端点与标注书文件生成器（基础版）

Status: done

Spec: `.scratch/annotated-book-export/spec.md`

## Scope

- `GET /api/books/:id/export`（挂在 `apps/server/src/books-router.ts`）：
  书不存在 404；非 `ready` 状态 409（对齐现有章内块查询的拒绝行为）；成功返回 HTML 附件，
  `Content-Disposition` 用 `filename*`（RFC 5987）承载中文书名
- 新模块 `apps/server/src/export/annotated-book.ts`：从库内 chapters + blocks 渲染
  自包含 HTML（章内块查询参照 `books-router.ts` 现有章内块查询）；按原序渲染全部块类型
  （章节标题、paragraph / code / raw / 图片占位 + 句子块三行），code 保留空白
- 句子块三行布局，内联样式镜像应用内 class 语义
  （`.sentence-block` / `.original-line` / `.ipa-line` / `.translation-line` / `.ipa-word`，
  词与音标逐词配对）；系统字体栈；桌面优先、手机可用（响应式）
- 文件内显示开关：音标行/译文行两个独立开关，切换根节点 CSS class；隐藏选择器同时覆盖
  逐词配对形态（`.ipa-word-ipa`）与旧数据平铺形态（`.ipa-line`），词干 `.ipa-word` 不受影响
  （隐藏音标后词仍可见可点）；默认全显；localStorage 记忆带 try/catch 守卫，失败回落全显；
  原文行不可隐藏
- 安全序列化：书名/章节标题/原文/译文进入 HTML 前做上下文转义（文本、属性各按其所），
  内嵌 JSON 防 `</script>` 提前闭合——书内容一律视为不可信输入
- 旧数据兼容：`ipa_slots` 为空的块沿应用内现行平铺兜底（`ipa_text`），不强行拆词配对
- 译文缺失的句子省略译文行（与应用内阅读一致）
- 自包含红线：零外部资源引用（无 CDN 脚本、无网络字体、无外链图片）

## Review Gate（收尾前必须执行，勿忘）

- `/code-review` 通过后，运行 `/cc-suite:qwen-review` 审查本次改动的源文件
  （`--target` 只传本次改动的文件；绝不传 .env、密钥或无关文件）
- 审查重点：自包含红线（输出无任何外部资源引用）、显示开关的 localStorage
  try/catch 守卫、Content-Disposition 中文文件名编码
- Qwen 是批评者而非编辑者：其每条实质发现必须逐条对照代码验证，
  接受/驳回/搁置的结论连同审查 jobId 写入收尾报告，主动提醒用户查看
- Qwen 不可用（preflight 报错）时：把 errorCode 记入收尾报告，不阻塞本票完成

## Acceptance

- supertest：种子书导出 200 + Content-Disposition 断言；输出含全部句子块的
  原文/音标/译文；无外部资源引用（含 CSS url() 与 JS 发起请求）；404 与非 ready 409 路径
- 对抗性夹具：书名与正文含 `<script>`/`</script>`/引号/HTML 注释——导出后仍为纯文本、不执行
- 混合内容夹具：标题 + 段落 + code + raw + 图片占位的多章书按序完整导出
- 旧数据块（`ipa_slots` 为空）平铺兜底渲染，原文行不丢
- jsdom 载入导出 HTML：两个开关各自隐藏对应行、原文行不受影响、
  状态记忆与守卫回落（可注入 storage mock）
- 不打真实 DeepSeek（用既有假翻译器测试基建造种子书）

## Comments

- 2026-10-19 (Claude): 实现。**端点**：`GET /api/books/:id/export` 挂在 books-router，复用 `bookFromParams` + `respondIfNotReady`（书不存在 404、非 ready 409，与章内块查询同门禁），成功经 Express `res.attachment()` 返回 `text/html` 附件——文件名先经 `annotatedBookFilename` 清洗（`\/:*?"<>|` 与控制字符 → `_`、Windows 尾点尾空格剥除、清空回落 `book.html`），中文书名由 content-disposition 以 RFC 5987 `filename*` 百分号编码承载，纯 ASCII 回落名保底。**生成器**：新模块 `apps/server/src/export/annotated-book.ts`，单条 chapters LEFT JOIN blocks 查询按原序取全书（仅标题章节、无题导语章节都渲染），分词正则直接从 `dict/ipa-line.ts` 导出共享 `WORD_PATTERN`（不另设副本；web 的 ReadingView 同步副本照旧）；句子块三行镜像应用内 class 语义与数值（词与音标逐词配对 `.ipa-word`/`.ipa-word-ipa`，词典外词 `.lookup-word`），`ipa_slots` 与词数不配或为 NULL 走 `ipa_text` 平铺兜底（最稀疏的 NULL slots + NULL ipa_text 渲染空占位行，与应用一致）；译文缺失（null 或空白）整行省略——规格声明的与应用内唯一的展示差异；code 块 `<pre><code>` 保空白、图片仅占位 + alt、转义（文本/属性同一 `escapeHtml`：& < > " '）。**显示开关**：工具栏两个独立 checkbox（默认全显），脚本在 `<body>` 上切 `hide-ipa`/`hide-translation` 根类；CSS 隐藏选择器同时覆盖 `.ipa-line`（旧平铺）与 `.ipa-word-ipa`（逐词配对），词干 `.ipa-word` 与原文行永不被隐藏（词保持可见可点，为票 02 点词留位）；localStorage getItem/setItem 各自 try/catch 守卫，访问即抛（file:// 场景）回落全显且页内切换照常工作，记忆键 `lingualeaf-export.show-ipa`/`.show-translation`。**自包含红线**：整个 `<style>`/`<script>` 内联，无 link/img/iframe/object/embed，CSS 无 `url()`/`@import`，脚本零网络调用（fetch/XHR/WebSocket/sendBeacon/EventSource/import 均无），有 DOM 级断言钉住。**安全**：对抗夹具（书名+正文含 `<script>`/`</script>`/引号/HTML 注释/`__pwned` 金丝雀）验证转义后为纯文本、`runScripts: 'dangerously'` 真执行后金丝雀未置位、全文 script 元素恰 1 个（文件自身的开关脚本）。**测试**（12 条，supertest + jsdom 文件行为缝）：200/Content-Disposition、逐词配对+译文省略计数、404、held 翻译器 409→ready 200、中文书名 filename* + 清洗、对抗转义、混合内容跨章按序、旧数据平铺兜底（NULL slots / NULL slots+NULL ipa_text 两档）、edge 形状书（无题导语/无 alt 图/仅标题章/文件名回落 book.html）、jsdom 双开关独立+原文行词干不受影响+重开恢复+拒绝存储回落、红线静态断言。不打真实 DeepSeek（假翻译器基建造种子）。**门禁**（退出码已验）：`npm run verify`（typecheck + 129/129 + lint + build）全绿；生产构建真机冒烟（:3111，--noproxy）上传→ready→导出 200，`filename*=UTF-8''%E5%86%92…`、转义与占位符均在。**code-review 双轴**：Standards 指出覆盖缺口（仅标题章/空标题回落/无 alt 图/NULL ipa_text）与测试重复——已修（新增 edge 夹具与断言、抽 `textFlow`/合并 `loadExport` options）；Spec 判定忠实，两条轻微越界（文件名清洗属规格行为前置到服务端、GLOSSARY/.cc-suite 改动系用户会前自有未提交修改，非本次引入）——保留并在此记录。**Review Gate：Qwen 不可用**，preflight `error_code: qwen_not_found`（PATH 无 qwen 可执行），按票面约定记入本报告、不阻塞；如需补审请安装 Qwen Code 后重跑 `/cc-suite:qwen-review`。**人工验收提示**：本票无强制人工步骤；票 03 收尾会有断网+停服务的双击冒烟清单。内嵌 JSON 序列化（防 `</script>`）随票 02 词汇表嵌入落地——本票无 JSON 通道，未预置死代码。
