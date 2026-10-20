# PDF 分章与书名

Status: ready-for-agent

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
