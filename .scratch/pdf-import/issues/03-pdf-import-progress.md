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
