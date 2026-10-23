# 02 · 导入管线删掉 translating 阶段

Status: ready-for-agent

## Scope

- `apps/server/src/import/import-task.ts`:删除 translating 阶段与
  translateChapters 调用(annotating → saving 直达);失败文案与 settle
  语义不动;translation-join 的收集-回填结构随阶段退场。
- `apps/server/src/wire.ts`:ImportStage 收窄为 'annotating'|'saving'。
- `apps/web/src/importCopy.ts`:删除 translating 文案分支。
- `apps/server/src/main.ts`:runImportTask 入参退掉 translator 装配;
  DEEPSEEK 未配置的启动警告保留(票 04 的按钮置灰仍需知道可用性)。
- 测试:api.test.ts 中"导入即含译文"的值级断言改为"导入后译文为 NULL";
  「留空」语义的测试迁到票 03 的新路由上延续,不删除。

## Gate

`npm run typecheck && npm test && npm run lint` 绿(看退出码);随后
`npm run verify` 全绿。基线 = 本票首个实现 commit 之前的 HEAD。行为信封:
契约套件断言零删除零改写;api.test 对导入形状的值级改写属本票范围;
「留空」语义必须在新路由测试中重现后才算本票收口。
