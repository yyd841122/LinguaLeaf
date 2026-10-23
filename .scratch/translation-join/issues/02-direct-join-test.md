# 02 · runImportTask 直测:混排章节的 join 落点

Status: ready-for-agent

## Scope

- 新建 `apps/server/test/import-task.test.ts`:
  - `openDatabase(":memory:")` + `createFixtureDictionary` +
    `createFakeTranslator`;
  - 手搭 PreparedBook:一章 paragraph(两句)/ image / code /
    paragraph(一句)混排 + 一章单句;`createImportingBook` 后直接
    await `runImportTask`;
  - 断言 `loadChapter` 读回:翻译按句子序落在句子块上(非原始块下标),
    image / code 块 translation 保持 null;空译文(null)路径由现有
    HTTP 测试钉住,不重复;
  - 断言 fake translator 收到的 batch 是纯句子文本(收集侧形状)。
- 不动 api.test.ts / contract.test.ts。

## Gate

`npm run typecheck && npm test && npm run lint` 绿;随后 `npm run verify`
全绿(看退出码)。

## Comments

