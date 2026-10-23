# 02 · web 消费契约:标签按共享 union、文案按 code

Status: done

## Scope

- 新建 `apps/web/src/importCopy.ts`:`IMPORT_STAGE_LABELS:
  Record<ImportStage, string>`(全量键)、`importStageLabel(stage, percent)`
  (未知 stage → 「处理中」,pinned)、`IMPORT_ERROR_COPY:
  Record<ImportErrorCode, string>`、`importErrorCopy(code)`(未知 code → null)。
  类型 `import type` 自 `../../server/src/wire`。
- `BookshelfPage.tsx`:删本地 `BookStatus` 副本与 string 键标签 map;`BookSummary`
  的 `status` / `importStage` 改用共享 union;上传 catch 改为读 `body.code` →
  `importErrorCopy`,未知/无 code → 「导入失败，请重试。」;渲染处调
  `importStageLabel(book.importStage, book.importPercent)`。
- `bookshelf.test.tsx`:
  - 扫描件 / 加密 mock body 补 code(按真实响应形状);
  - 新增:413 + file-too-large code → 「导入失败：文件超过 20MB 上限。」;
  - 新增:未知 code(如 "planet-x")→ 「导入失败，请重试。」(钉 code 守卫);
  - unknown-stage 测试保留,注释改为 pinned 表述。

## Gate

`npm run typecheck && npm test && npm run lint` 绿。全仓 grep 不应再有
`body?.error ===` 形态的文案机判与 `Record<string, string>` 的 stage 标签 map。

## Comments

Done in 191ba64. Gate greps hold repo-wide: zero `body?.error ===`
comparisons, no string-keyed stage map. The two fallbacks landed as
pinned tests per spec 决策 3. Review fixes (f531109): the four coded
rejection mocks collapsed into one `mockUploadRejection` helper; the 20MB
copy lines now carry a comment tying them to MAX_UPLOAD_BYTES; the catch
comment that said the opposite of the code was rewritten.

Acceptance (2026-10-23, human): 加密 PDF 上传实测通过 —— 书架按 code 命中
「导入失败：加密 PDF 暂不支持。」,服务端改文案不再影响该分支。
