# PDF 文本层抽取与扫描件判定

Status: ready-for-agent

Spec: `.scratch/pdf-import/spec.md`

## Scope

- 【开工前置，勿跳】先跑 `/cc-suite:review-plan .scratch/pdf-import/spec.md` 预审本 spec，
  发现与 annotated-book-export 的实现经验合并修订、经用户确认后再开始下面的工作
- 服务端文件名分派加 `isPdfFilename`（`apps/server/src/books-router.ts`）；
  `accept` 加 `.pdf`（`apps/web/src/BookshelfPage.tsx`）
- 新模块 `apps/server/src/import/pdf.ts`：pdfjs-dist（或 unpdf）文本层抽取，
  产出与 `import/epub.ts` 同形的 PreparedBook，后半程管线零改动复用
- 抽取卫生：行尾连字符断词合并、连字规范化（ﬁ → fi）、
  重复页眉/页脚/页码行剔除（多页重复短行启发式）
- 扫描件判定：逐页文本长度中位数低于阈值 → 422 + 明确文案
  "扫描件/图片型 PDF 暂不支持"，不建书；阈值可调、倾向保守
- 确定性 fixture PDF 生成脚本（固定页数/文本/书签，杜绝时间戳类不确定因素）

## Review Gate（收尾前必须执行，勿忘）

- `/code-review` 通过后，运行 `/cc-suite:qwen-review` 审查本次改动的源文件
  （`--target` 只传本次改动的文件；绝不传 .env、密钥或无关文件）
- 审查重点：扫描件判定阈值的误拒/误放边界、连字符断词合并的正确性、
  fixture PDF 的确定性（无时间戳等不稳定因素）
- Qwen 是批评者而非编辑者：其每条实质发现必须逐条对照代码验证，
  接受/驳回/搁置的结论连同审查 jobId 写入收尾报告，主动提醒用户查看
- Qwen 不可用（preflight 报错）时：把 errorCode 记入收尾报告，不阻塞本票完成

## Acceptance

- supertest：文本型 fixture 正常导入成书（句子块含期望原文，假翻译器供译文）；
  扫描件 fixture 返回 422 与明确文案；跨行连字符词在结果中合并（缝上断言）
- 不打真实 DeepSeek
- 修订追加（2026-10-20 review-plan 合并，用户已确认）：换行句与跨页句各出**单个**块；
  连字（ﬁ）行规范化后出现在块中；页眉/页脚/页码行不出现而正文重复短行存活；
  坏字节 .pdf 返回 400；fixture 确定性=双次生成字节相等；web 422 分支文案 + fetch 缝测试；
  书签 fixture 归票 02

## Comments

### 2026-10-20 开工前置 gate：/cc-suite:review-plan 预审完成（NEEDS REVISION → 合并修订，待用户确认）

- Codex jobId `review-plan-mvg1yzh8-zm38ck`，threadId `01a15719-3ab5-7863-a9d5-d10f2bc7c758`（`/cc-suite:continue` 可续）
- 15 条发现已逐条对照代码验证，关键确认：`pipeline.ts:7` 的 `BookFormat` 联合类型不含 pdf；
  `apps/web/src/api.ts` 的 `ApiError` 丢弃错误体（422 文案到不了读者）；
  `books.format` 是无约束 TEXT（无需迁移）；sbd `newline_boundaries:true` 会被 PDF 硬换行切碎句子
- 合并修订决策（含 annotated-book-export 经验，见 CODING_STANDARDS.md）已提交用户确认，
  确认后写回 spec.md 再动代码。决策摘要：BookFormat 扩 "pdf"；web 加 422 分支文案 + fetch 缝测试；
  PdfParseError→400 / 扫描件→422 / 加密→400 / 页数上限 2000→400；解析库 unpdf（单一 document，finally destroy）；
  行重建（hasEOL → 行 → 清理 → 章内合并为段落，缝上断跨页句）；清理规则（连字 ﬀﬁﬂﬃﬄ、
  行尾连字符合并、页眉页脚候选=每页首末各 2 行且 ≥3 页重复才删、纯数字页码行 ≥3 页才删）；
  扫描判定=逐页清理后字符数中位数 <100 → 422；fixture 用 pdf-lib `updateMetadata:false` + 固定 PNG，
  双次生成字节相等断言；进度 99→saving→ready 语义归 ticket 03

### 2026-10-20 实施记录（TDD，12 个缝上切片）

- 新模块 `apps/server/src/import/pdf.ts`：unpdf 抽取 → hasEOL 行重建 → 连字规范化 →
  页眉/页脚/页码剔除（每页首末各 2 行候选，≥3 页重复才删）→ 软连字符折叠 →
  中位数 <100 扫描门（ScannedPdfError→422）；PdfParseError→400（坏字节/加密/超 2000 页）；
  单一 loadingTask，finally destroy；ticket 01 过渡为全书单章，书名 metadata ?? 文件名
- `pipeline.ts` BookFormat + "pdf"（唯一的前半程契约改动）；`books-router.ts` 加 isPdfFilename
  分派与 422/400 映射；web `BookshelfPage.tsx` accept 加 .pdf、422 分支文案、415 文案更新
- fixture：`test/fixtures/pdf.ts` — pdf-lib（updateMetadata:false）文本页、固定 PNG 扫描页、
  手写 Type0+ToUnicode 连字页（标准字体字形名到不了 U+FB01，pdf.js 的 NFKC 也会折叠 ﬁ，
  本测试钉住端到端结果）、/Encrypt 加密页、copyPages 超页页；全部无时间戳
- 实施中的发现：pdf.js getTextContent 在文本行超出 MediaBox 右缘时按页宽截断
  （fixture 初版单行长句在 ~45 字形处被剪，已按真实排版折行）；编译产物 `.output` 下
  readPdfBook 实测可用（tsx 与 node 双路径验证）
- 门禁：typecheck 0、lint 0、build 0、vitest 153/153（14 文件）；注意点：
  `set -o pipefail` 下看真实退出码（tail 曾吞过一次构建失败的退出码）

### 2026-10-20 /code-review 结果（双轴）与修复

- Standards 轴：0 硬违规；judgement calls —— fixture 手写 PDF 序列化重复（已提取 `writeRawPdf`）、
  `dropRunningHeads` 边界判定重复（已提取 `isMarginLine`/`isFolio`）、router 错误级联增长
  （两族规模，按审查者意见保留）。补上"正好阈值=100 放行"边界测试
- Spec 轴：无 scope creep；两条偏差已修——加密 400 body 现为 verbatim"加密 PDF 暂不支持"
  （新增 `EncryptedPdfError extends PdfParseError`，router 单独映射）；
  页眉重复判定改为归一化（大小写折叠）键，标点漂移存活记为 v1 已知边界；
  字节相等断言补齐全部 5 个 fixture builder
- 门禁复跑：typecheck 0 / lint 0 / vitest 154/154 / build 0

### 2026-10-20 收尾报告（ticket 01 完成）

- **实现**：3 个提交 —— `1de6987`（实现）、`b68a880`（双轴 review 修复）；docs 提交 `5288ac2`
  先行（spec 修订 + 票 01-03 入库，含开工前置 gate 产物）
- **门禁**：typecheck 0 / lint 0（--max-warnings 0）/ build 0 / vitest 154/154；
  编译产物 `.output` 下 readPdfBook 双路径（tsx + node）实测可用
- **开工前置 gate**：/cc-suite:review-plan 完成（NEEDS REVISION，15 条发现逐条验证，
  修订经用户确认后写回 spec.md；threadId `01a15719-3ab5-7863-a9d5-d10f2bc7c758`）
- **/code-review**：Standards 轴 0 硬违规 + 4 judgement calls（writeRawPdf 提取、
  isMarginLine/isFolio 提取已做；错误级联按审查者意见保留）；Spec 轴无 scope creep，
  两条偏差已修（加密 400 body verbatim 文案 EncryptedPdfError；页眉归一化键大小写折叠）。
  详细结论见上一条 Comment
- **/cc-suite:qwen-review**：**未执行** —— preflight `status: error, error_code: qwen_not_found`
  （qwen 不在 PATH）。按本票 Review Gate 约定记录 errorCode、不阻塞完成。
  若日后安装 Qwen Code，可用 `--target` 重审上述 7 个改动文件
- **已知 v1 边界（记录在代码注释与 spec Revisions）**：`well-\nknown`→`wellknown`；
  页眉跨页标点漂移存活；混合扫描书误放（中位数判定固有）；pdf.js 对超 MediaBox 右缘的
  文本行会按页宽截断（fixture 已按真实排版折行规避）
- **验收对照**：文本 fixture 正常导入成书（句子块 + 假翻译器译文）✅；扫描件 422 + 文案 +
  不建书 + 翻译器零调用 ✅；跨行连字符合并（缝上断言，含跨页句）✅；不打真实 DeepSeek ✅
- 下一张票：02（书签分章与书名）依赖本票，ready-for-agent
