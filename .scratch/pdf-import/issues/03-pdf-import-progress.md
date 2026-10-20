# PDF 导入百分比进度与大文件提示

Status: ready-for-agent

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
