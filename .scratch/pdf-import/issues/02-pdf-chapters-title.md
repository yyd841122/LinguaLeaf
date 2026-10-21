# PDF 分章与书名

Status: done

Spec: `.scratch/pdf-import/spec.md`

Depends on: 01

## Scope

- 有 outline（书签）：按书签目标页切章，书签标题作章节名
- 无 outline：每 ~10 页一章（"第 N–M 页"）；不做正文标题智能识别
- 书名：PDF metadata title，缺省文件名去扩展名

## Acceptance

- supertest：带书签 fixture 按书签分章（章数与章节标题断言）；
  无书签 fixture 按页切块；无 metadata title 时书名回退文件名
- 全链路走假翻译器，不打真实 DeepSeek

## Review Gate（收尾前必须执行，勿忘）

- /implement 结束后由委托会话补跑完整门禁：npm install → typecheck → test → lint → build（看 `npm run verify` 退出码，勿只看 tail）→ 生产与 dev E2E（curl 加 --noproxy '*'）
- 门禁全绿后自动运行 `/code-review`（Standards + Spec 双轴，定点基准 = 本票开工前 HEAD，应为 c9799da）
- 运行 `/cc-suite:qwen-review` 审查本次改动源文件（--target 只传改动文件；绝不传 .env、密钥或无关文件）；Qwen 不可用（preflight 报错）时把 errorCode 记入收尾报告，不阻塞
- 审查重点：书签分章的章界正确性（最后一章收尾页归属）、无 outline ~10 页切块的章数与"第 N–M 页"命名、书名回退顺序（metadata title ?? 文件名去扩展名）、书签 fixture 确定性（双次生成字节相等）
- 收尾报告主动提醒用户查看审查结论；本票收官时提醒：票 03 为本 feature 末票，/clear 前跑 /retro

## Comments

### 2026-10-20 实施记录（Codex 委托实现）

- 委托：cc-suite /implement → Codex `gpt-6.1-sol/high`，workspace-write 沙箱；
  jobId `implement-mvg6evsc-l86qqh`，threadId `01a1578b-0f42-7392-bf12-5ebe7213b2c2`（/cc-suite:continue 可续）
- `apps/server/src/import/pdf.ts`：chapterStarts（outline DFS → 目标页解析[命名 dest/页引用/页索引，
  越界与失效书签记 null 跳过] → 物理页序稳定排序 → 首书签前合成页段章 / 无可用书签回退每 10 页
  "第 N–M 页"）；章文本按 [start, 下一 start) 切页后走票 01 的 foldLines，空章 items=[]
- fixture：`createBookmarkedPdf` —— pdf-lib 低层 context API 手写 outline 对象树（Prev/Next/First/Last/
  Count 链、嵌套 children、命名 dest 走 /Names Dests 名树、页引用与页索引两种 Dest 形态、
  destinationless 分组节点），`updateMetadata:false`，双次生成字节相等断言入库
- 测试：书签分章（章数+标题+逐章页归属，嵌套/命名 dest 全覆盖）、10/11/23 页三种无书签切块、
  乱序 outline + 同页重复书签 + 分组节点、无本地目标回退页段、书名回退（.PDF 大写扩展名、
  两种 fixture 双跑）、书签字节确定性；假翻译器全链路
- 沙箱限制按预期：Codex 端 supertest 因 `listen EPERM` 跑不了 HTTP 用例（沙箱无端口），完整门禁由
  本会话补跑

### 2026-10-20 门禁与 E2E（委托会话补跑）

- `npm install` 退出码 0；`npm run verify`（typecheck→test→lint→build 串联）退出码 0，
  vitest 162/162（14 文件，净增 7 用例）；审查修复后复跑 `npm run verify` 退出码 0、162/162
- E2E：编译产物 `.output/server/import/pdf.js` readPdfBook 实测 —— 书签 fixture 三章
  （Opening / A Turning Point / Finale — 最后一章），页头落位正确（1–2/3–4/5–6）；
  无书签 11 页 → "第 1–10 页 | 第 11–11 页"；书名回退 "My E2E Book"（.PDF 大写扩展名正确剥除）
- 生产 `node .output/server/main.js`：/api/health 200、/ 200；dev（tsx 源码路径）：/api/health 200
  （本仓库 web workspace 无 dev script，dev 轴即 tsx 服务端；web 产物由 prod / 200 覆盖）

### 2026-10-20 /code-review 结果（双轴，基准 c9799da）与修复

- Standards 轴：0 硬违规；fixture 真实形状建模与块形状断言被点名合规。judgement calls 4 条，
  采纳修复 4 条：① `pageRangeTitle` 参数语义改 zero-based inclusive 双参 + 注释（消除 start/end
  不对称陷阱）；② fixture 名树 `localeCompare` → code-unit 比较（字节确定性跨环境 + PDF 名树
  本就按字节序）；③ `getOutline()` 失败由抛 400 降级为按页切块（与单条失效书签的容忍一致，
  消除误导报错）；④ outline DFS 加 `MAX_OUTLINE_DEPTH=64` 护栏（病态/自引用书签树）
- Spec 轴：无缺失/部分实现；章界数学、dest 解析、回退逻辑无正确性问题。scope creep 3 条裁决：
  首书签前合成"第 1–N 页"章——保留（否则那些页被静默丢弃；spec 未言明，记 v1 决策）；
  同页重复书签各自成章、中间章为空——保留（代码注释+测试已钉住）；书名回退测试收紧
  （.PDF 大写 + 双 fixture）——无害，保留。已修的 400→降级项即 Spec 轴第 (b)3 条
- 修复后门禁复跑全绿（见上条）

### 2026-10-20 收尾报告（ticket 02 完成）

- **实现**：2 个提交 —— `519567c`（Codex 实现，feat）、`ba00071`（双轴 review 修复，refactor）
- **门禁**：install 0 / `npm run verify` 退出码 0（typecheck 0 / vitest 162/162 / lint 0 / build 0），
  修复前后各跑一轮；编译产物 E2E 章节、页归属、书名回退逐字验证
- **/code-review**：Standards 0 硬违规（4 judgement calls 全部采纳修复）；Spec 无缺失、
  3 条 scope creep 逐条裁决（2 保留 1 已修）；qwen-review **未执行** —— preflight
  `status: error, error_code: qwen_not_found`（qwen 不在 PATH），按本票 Review Gate 约定记录
  errorCode、不阻塞完成
- **v1 已知边界（记录在案）**：句子不跨章 —— 书签落在句中时句子切到两章（与 EPUB 章界同语义；
  spec 的"跨页句完整"指章内页拼接处）；嵌套书签扁平化为 level:null 章不做层级（Spec 轴点名的
  产品缺口）；同页重复书签的中间章为空章；outline 树整体损坏降级按页切块
- **验收对照**：书签 fixture 按书签分章（章数+章节标题断言）✅；无书签 fixture 按页切块 ✅；
  无 metadata title 书名回退文件名 ✅；全链路假翻译器、零真实 DeepSeek ✅
- **下一张票：03（导入进度百分比 + 长书耗时提示）为本 feature 末票 —— 勿忘收官时在 /clear 前
  跑 /retro（本票 Review Gate 已埋提醒）**

