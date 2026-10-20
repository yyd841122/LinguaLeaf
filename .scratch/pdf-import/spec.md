# Spec: PDF 导入（文本层完好 PDF）

Status: ready-for-agent

## Problem Statement

v1 只支持 EPUB 和 Markdown 两种书源。网上大量英文书/文章以 PDF 形式存在，
用户拿到 PDF 仍需先转格式才能导入，路径断裂。

## Solution

书 (Book) 新增 PDF 输入格式：导入时先抽取文本层，判定为扫描件则明确拒绝、不做任何导入；
抽取成功后完全复用现有管线（分句 → 音标 → DeepSeek 译文 → 句子块入库）。
分章用 PDF 书签目录，无书签按固定页数切块。导入全程百分比进度可见——
这是用户接受大 PDF 20–60 分钟导入耗时的明确前提。扫描件永久排除（v1 spec 既有决策），
不做 OCR，不还原版式（ADR-0001）。

## User Stories

1. As a 读者, I want to 导入文本层完好的 PDF, so that PDF 书也能对照标注阅读
2. As a 读者, I want to 导入扫描件时得到明确的"不支持"提示, so that 不发生无声失败或半成品书
3. As a 读者, I want to PDF 有书签目录时按书签分章, so that 长书导航符合原书结构
4. As a 读者, I want to 无书签的 PDF 按固定页数分章, so that 依然可以用目录跳转
5. As a 读者, I want to 导入全程看到百分比进度, so that 长等待可预期、不像是卡死
6. As a 读者, I want to 页数很大的 PDF 导入时看到"预计耗时较长"的提示, so that 我对等待有预期

## Implementation Decisions

- 上传：`accept` 加 `.pdf`（`apps/web/src/BookshelfPage.tsx`）；服务端文件名分派加
  `isPdfFilename`（`apps/server/src/books-router.ts` 现有 EPUB/MD 分派旁）；
  20MB 上传上限沿用
- 解析库：pdfjs-dist（Node 侧；或其轻封装 unpdf），新模块 `apps/server/src/import/pdf.ts`，
  产出与 `import/epub.ts` 同形的 PreparedBook——后半程（分句/IPA/翻译/入库）零改动复用
- 扫描件判定：逐页取文本长度，中位数每页低于阈值（如 100 字符）→ 422，
  错误信息明确"扫描件/图片型 PDF 暂不支持"；阈值实现时可调，倾向保守
- 抽取卫生：行尾连字符断词合并（exam-\nple → example）、连字规范化（ﬁ → fi）、
  重复页眉/页脚/页码行剔除（多页重复短行的启发式）；双栏按文本流抽取，不保证阅读顺序完美
- 分章：PDF outline（书签）存在 → 按书签目标页切章，书签标题作章节名；
  无 outline → 每 ~10 页一章（"第 N–M 页"）；不做正文标题智能识别
- 书名：PDF metadata title，缺省用文件名去扩展名
- 进度：翻译批次 完成数/总数 映射为百分比，导入进度 UI 全程可见百分比
  （`import-task.ts` 已有阶段与进度回调，本次补齐百分比展示）；
  进度面板对页数多的书显示"预计耗时较长"提示；禁止无反馈等待
- 费用与路线不变：导入时预生成（ADR-0002），大 PDF 20–60 分钟为已知代价，
  任务服务端后台跑、可中途离开，服务重启才中断（现状行为）

## Testing Decisions

- 服务端缝：小体积确定性 fixture PDF（脚本生成，固定页数/文本/书签，杜绝时间戳类
  不确定因素）覆盖：文本型正常导入（块结构 + 假翻译器译文）、扫描件 422 与文案、
  书签分章、无书签按页切块、进度百分比单调递增至 100%
- 抽取卫生在缝上断言结果（合并后的词出现在原文/音标行中），不单测内部函数
- Web 缝：accept 含 .pdf；导入进度组件展示百分比
- 不打真实 DeepSeek、不依赖真实大 PDF
- 好测试只验外部行为（沿 v1 spec 测试决策）

## Out of Scope

- 扫描件/OCR（永久排除，v1 spec 既有决策）
- PDF 版式还原、双栏智能重排（ADR-0001：只渲染库内句子块数据）
- 加密/密码保护 PDF
- 页内图片提取（沿 EPUB 路径现状：仅占位）

## Further Notes

- **开工前置（用户要求的提醒点）**：`/implement` 本 feature 任何票之前，先跑
  `/cc-suite:review-plan .scratch/pdf-import/spec.md` 预审，把发现连同 annotated-book-export
  的实现经验合并修订、经用户确认后再动代码
- 用语以 GLOSSARY.md 为准（书、导入、句子块、章节等）
- 实施顺序：本 feature 在 annotated-book-export 之后（用户决策）；两者代码无依赖
- 相关 ADR：0001（不渲染原版式）、0002（导入时预生成）、0003（导出格式）；本 feature 不推翻三者

## Revisions

### 2026-10-20 开工前置预审合并（/cc-suite:review-plan，gpt-6.1-sol/high，经用户确认）

- 解析库定为 **unpdf**（纯 ESM、零原生依赖，Node ≥22.12 即用；pdfjs-dist 直用需配 worker）。
  单一 document 生命周期，`finally destroy()`
- "后半程零改动"修订为：`BookFormat` 联合类型扩 `"pdf"`（pipeline.ts 一处，前后半程一起继承）；
  `books.format` 是无约束 TEXT、web 侧 `format: string`，无迁移
- 抽取卫生落地规则：连字 ﬀﬁﬂﬃﬄ 规范化；行尾连字符 + 下行字母开头 → 去连字符拼接
  （`well-\nknown` → `wellknown` 为 v1 已知取舍，记录在实现处）；
  页眉/页脚/页码候选**仅取每页首末各 2 行**，同一归一化文本 ≥3 页重复才删，
  纯数字页码行 ≥3 页出现才删；正文中部重复短行不动（负向 fixture 断言存活）
- 行重建：按 text item 的 `hasEOL` 组行 → 清理 → 章内合并为段落 item 后再分句，
  印刷换行不得成为句子边界（sbd 开着 `newline_boundaries`）；跨页句在章文本拼接处保持完整
- 扫描判定：逐页**清理后**字符数中位数 < 100（具名常量，可调）→ 422；正好 100 放行；
  空白/封面页计入中位数（文本书夹封面不误拒）；混合扫描书误放为 v1 已知限（无 OCR，沿 ADR-0001）
- 错误分类：坏字节/加密 PDF → 400（`PdfParseError`，加密文案"加密 PDF 暂不支持"）；
  扫描件 → 422（`ScannedPdfError`）不建书不翻译；页数 > 2000 → 400；>20MB 沿用 413
- web：`uploadBook` 加 422 分支显示扫描件文案（`ApiError` 丢弃错误体，文案在前端映射，
  服务端 JSON 体同名文案并存）；`accept` 加 `.pdf`；fetch 缝测试注入 422
- 进度语义本次不动：翻译百分比 99 → `saving` → shelf `ready` 即完成；
  "单调递增至 100%"按"单调不降 + 最终 ready"解释，百分比展示归票 03；
  解析（POST 内同步）由 20MB 上限 + 页数上限两道界兜住
- fixture：pdf-lib `create({ updateMetadata: false })` + 固定 base64 PNG 图片页，
  **双次生成字节相等**断言；书签 fixture 归票 02（pdf-lib 无 outline API，届时用低层 context API）
- ticket 01 过渡行为：全书单章；书名 = metadata title ?? 文件名去扩展名
  （绕过 `deriveBookTitle` 的首标题回退，票 02 再细化）
