# PDF 导入百分比进度与大文件提示

Status: done

Spec: `.scratch/pdf-import/spec.md`

Depends on: 01

## Scope

- 翻译批次 完成数/总数 映射为百分比；核对现有导入进度机制（`import-task.ts`
  阶段与进度回调 + 前端进度 UI），补齐百分比展示，导入全程可见、禁止无反馈等待
- 进度面板对页数多的书（> 300 页）显示"预计耗时较长"提示

## Acceptance

- 服务端缝：假翻译器下进度事件百分比单调递增至 100%
- Web 缝：accept 含 .pdf；导入进度组件渲染百分比
- 手工冒烟：真实多页 PDF 导入期间百分比持续变化，无无反馈等待
- **收官提醒（勿忘）**：本票是整个 build（annotated-book-export + pdf-import）的最后一张票，
  完成后在 `/clear` 之前主动提醒并协助用户对本会话跑 `/retro`

## Review Gate（收尾前必须执行，勿忘）

- /implement 结束后由委托会话补跑完整门禁：npm install → typecheck → test → lint → build（看 `npm run verify` 退出码，勿只看 tail）→ 生产与 dev E2E（curl 加 --noproxy '*'）
- 门禁全绿后自动运行 `/code-review`（Standards + Spec 双轴，定点基准 = 本票开工前 HEAD，应为 9a7b35f）
- 运行 `/cc-suite:qwen-review` 审查本次改动源文件（--target 只传改动文件；绝不传 .env、密钥或无关文件）；Qwen 不可用（preflight 报错，近期为 `qwen_not_found`）时把 errorCode 记入收尾报告，不阻塞
- 审查重点：进度百分比单调不降与终值语义（99→saving→ready 按 spec 修订解释）、>300 页提示阈值边界（300 本身显不显示）、假翻译器进度事件到 UI 百分比的映射缝、禁止无反馈等待的断言落在哪条测试
- 收尾报告主动提醒用户查看审查结论；**本票为整场 build 末票 —— 收官后在 /clear 前主动提醒并协助用户跑 /retro**（Acceptance 已有此条，此处勿忘勿跳）

### 2026-10-20 实施记录（TDD，5 个缝上切片）

- 服务端缝①：api.test.ts 新增「moves the shelf percent forward batch by batch, never backwards,
  and settles ready」——45 句 3 批次，假翻译器逐批 gate，经书架轮询端观测 [0, 44, 89]，
  sorted-equal 断言单调不降、max<100（99 诚实上界）、终态 ready 且 percent 清空；
  红灯阶段顺带实证：批次全失败走重试轮时 done 累计、percent 恒 99 不回退（重试不扰动单调性）
- 服务端缝② + schema 缝：pageCount 全链路（红→绿）——books.page_count 列（CREATE + 旧库
  in-place ALTER 迁移，addColumnIfMissing 守卫）、PreparedBook.pageCount?（pdf.ts 填 numPages，
  MD/EPUB 为 null）、createImportingBook 落行、books-router 双查询/JSON 出 pageCount；
  supertest 断言 PDF 6 页三缝（202 body / importing shelf / settled shelf）均在，MD 为 null；
  schema.test.ts 旧库迁移用例（旧行可读、可写、重开稳定）
- Web 缝：BookshelfPage.tsx —— BookSummary.pageCount、LONG_PDF_PAGES=300、isLongPdf(book)
  严格 >300，导入行 meta 追加「 · 预计耗时较长」；jsdom 用例钉 320 显 / 300 不显 /
  null（非 PDF 导入行）不显 / 导入结束不显；百分比文案（翻译译文 40%）既有用例已在
- 门禁：npm run verify 退出码 0（typecheck 0 / vitest 167/167 / lint 0 / build 0），实现与
  review 修复后各跑一轮
- 编译产物 E2E（生产缝，curl --noproxy '*'）：320 页真实 PDF + 本地 OpenAI 兼容 mock 端点
  （不打真实 DeepSeek）——202 即回 pageCount:320/translating/0%，轮询观测 58→69→79→90 单调
  上行，终态 ready+null；32 章（第 1–10 页 … 第 311–320 页）、译文行落块、产物 web bundle
  含「预计耗时较长」；dev（tsx 源码路径）/api/health 200；冒烟脚本与产物在
  /tmp/lingualeaf-smoke/（不入围墙）

### 2026-10-20 /code-review 结果（双轴，基准 1bbcdb9——本票开工前实际 HEAD，票面所写 9a7b35f
先于加gate 的 docs 提交）与修复

- Standards 轴：0 硬违规；5 条 judgement calls，采纳修复 3、有据弃置 2 ——
  ① books-router 书列在两处 SQL 手工同步（`as BookRow` 转型会漏检）→ 提取
  BOOK_COLUMNS + bookColumnSql(prefix) 单源；② schema.ts 单列 ALTER 守卫第三份拷贝 →
  addColumnIfMissing 帮手收拢 ipa_slots/page_count 两处；③ longBookHint 返回带分隔符的
  字符串名不副实 → 改布尔 isLongPdf + 分隔符挪到调用点；④ 百分比循环出口对 failed 状态
  会滑成 waitForShelfBook 超时 → 出口显式断言 status==="ready"；⑤ web 测试标题承诺的
  null-pageCount 场景未在其体内出现 → 补导入中非 PDF 行断言。弃 2（记录在案）：
  schema.test 迁移脚手架提取——该文件惯例是每个迁移 describe 自持一份忠实当期形状的
  CREATE TABLE，参数化历史 schema 反而耦合用例、掩盖各时代真实形状；shotgun surgery
  （一列触 10 文件）——分层单体固有，可收敛部分即 ①
- Spec 轴：无缺失、无 scope creep、无错误实现；验证点含阈值严格性（300 不显）、
  迁移次序（pre-ticket-08 库双 ALTER 皆得）、99→saving→ready 终值语义与修订解释一致；
  唯一发现即上述 ⑤（cosmetic，已修）
- /cc-suite:qwen-review：**未执行** —— preflight `status: error, error_code: qwen_not_found`
  （qwen 不在 PATH），按本票 Review Gate 约定记录 errorCode、不阻塞完成

### 2026-10-20 收尾报告（ticket 03 完成 —— pdf-import 末票，整场 build 收官）

- **实现**：2 个提交 —— `4dcb3de`（feat，TDD 五切片）、`2e72f9d`（refactor，双轴 review 修复）
- **门禁**：`npm run verify` 退出码 0 ×2（typecheck 0 / vitest 167/167 / lint 0 / build 0）；
  生产与 dev E2E 见实施记录（curl 均加 --noproxy '*'）
- **/code-review**：Standards 0 硬违规（5 judgement calls：3 采纳已修、2 有据弃置）；
  Spec 无缺失/无 scope creep/无错误实现（1 条 cosmetic 已修）
- **qwen-review**：errorCode `qwen_not_found`，未执行，不阻塞（同票 01/02）
- **待人工（勿忘）**：
  1. 浏览器侧手工冒烟（可选，缝上证据已齐）：起 mock（`node /tmp/lingualeaf-smoke/mock-deepseek.mjs 19311 200`）+
     起 prod（`DATABASE_PATH=/tmp/lingualeaf-smoke/data/ui.sqlite DEEPSEEK_API_KEY=x
     DEEPSEEK_BASE_URL=http://127.0.0.1:19311 PORT=19312 npm start`）→ 浏览器开
     http://localhost:19312 → 导入 /tmp/lingualeaf-smoke/long-book.pdf → 目视进度行
     百分比持续上行、「预计耗时较长」提示在行内（页数 320>300）
  2. **本票为整场 build（annotated-book-export + pdf-import）末票 —— /clear 之前跑 /retro，
     勿忘勿跳**
