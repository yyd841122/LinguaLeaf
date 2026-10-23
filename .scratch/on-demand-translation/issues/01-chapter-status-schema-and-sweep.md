# 01 · chapters 翻译状态列、初值推导与启动清扫

Status: ready-for-agent

## Scope

- `apps/server/src/schema.ts`:chapters 表加 `translation_status`
  (CHECK:'untranslated'/'translating'/'translated'/'failed',默认
  'untranslated')、`translation_error`(可空)、`translation_percent`(可空);
  迁移照旧库原地 ALTER 的既有模式。
- 初值推导(spec 决策 5):回填规则 = 有句子块的章置 'translated'
  (现实库 8 本书全句有译文),其余 'untranslated';译文数据本身零改动。
- 启动清扫(照 `failInterruptedImports` 的模式):残留 'translating' 的章 →
  'failed',translation_error 记「服务重启,翻译中断」;清 percent。
- 状态写入助手(镜像 book-store 的 setImportProgress 守卫式 UPDATE):
  置 translating、写 percent、按结果 settle;书已删时静默收场
  (照 persistBook 返回 false 的模式)。

## Gate

`npm run typecheck && npm test && npm run lint` 绿(看退出码);随后
`npm run verify` 全绿。基线 = 本票首个实现 commit 之前的 HEAD。迁移测试盖:
旧形状库 → 新列 + 推导初值;清扫测试直接手工置 translating 后触发。
