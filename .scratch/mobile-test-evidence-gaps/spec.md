# mobile 测试证据缺口批扫:词汇后端 catcher / 落点断言 / 字典资产门

**Status:** needs-triage

来自 mobile-app 02 独立终审发现 4+5+6(2026-11-16,threadId
01a1e1db-a5d2-75f0-9f2f-1c7b4accd86b,变异心证证据缺口簇):

1. 生产词汇后端接线和真实落盘路径无变异 catcher:默认后端换 memory 或删
   `vocabulary-store.ts:143/151` 的写入,现有词汇行为测试仍全绿。补默认
   组合根 + 真实词汇后端跨实例读回测试。
2. 打签/跳签/块内恢复无准确落点断言:`readerBookmarks.test.tsx:174` 仅
   断言 `block >= 0`;打签恒为块 0、删 scrollIntoView 均无 catcher。植入
   可区分块几何并断言精确目标。
3. `dictionaryAsset.test.ts:39`:CI 适配把「任一资产缺失」变成字节测试
   跳过,原终审 mutation 防线退化(当前两资产在且逐字节相同,门缺口
   非数据缺口)。建立资产必须存在的检查门,禁止静默跳过。

## Comments

- 2026-11-16 立票。
