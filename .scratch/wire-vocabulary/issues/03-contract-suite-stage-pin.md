# 03 · 契约测试钉「每个 stage 有标签」

Status: ready-for-agent

## Scope

`apps/server/test/contract.test.ts` 新 describe:store 直写
createImportingBook + 逐个 setImportProgress(字面量受 `ImportStage` 参数类型
约束),经真实 fetchJson 客户端读 shelf,断言:

- wire 上的 `importStage` 与写入值一致(toBookJson 驼峰映射真实生效);
- `IMPORT_STAGE_LABELS` 对每个 stage 有非空标签(`toContain` + 非空断言,
  对 union 值索引无需 cast)。

编译半边的保证在别处已成立(importCopy 的全量 Record + store 函数签名),
本票钉的是运行时半边:真实端点、真实客户端、真实信封。

## Gate

`npm run typecheck && npm test && npm run lint` 绿;随后全仓 `npm run verify`
绿(看退出码)。
