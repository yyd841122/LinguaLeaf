# 01 · wire.ts:导入 wire 词汇单一来源,错误体带稳定 code

Status: done

## Scope

- 新建 `apps/server/src/wire.ts`(types-only):`BookStatus`、`ImportStage`
  (声明从 book-store.ts 原文迁来,含注释)、`ImportErrorCode`
  (unsupported-format / invalid-epub / invalid-pdf / encrypted-pdf /
  scanned-pdf / file-too-large)、`ImportRejection = { code; error }`。
- `book-store.ts`:删除本地两个 union 声明,改 `import type ... from "./wire.js"`。
- `books-router.ts`:`import type { ImportRejection }`;UNSUPPORTED_FORMAT 标注
  类型并带 code;multer 分支 LIMIT_FILE_SIZE → 413 + `{ code: "file-too-large" }`
  (文案由 MAX_UPLOAD_BYTES 推出 MB 数);错误梯四个分支全部
  `{ code, error } satisfies ImportRejection`。
- `pdf.ts` 仅注释微调(加密子类注释从「body 承诺文案」改为「body 带稳定 code」)。
- 测试(同 commit 扩展契约套件,Standards 要求):
  - contract.test.ts 上传拒绝六连:415/422/encrypted 三个 toEqual 补 code;
    invalid-epub / invalid-pdf 补 code 断言;413 改断言
    `{ code: "file-too-large", error: ... }`,测试名同步改述。
  - pdf-import.test.ts:4 处 body.error 断言旁补 `.body.code` 断言。

## Gate

`npm run typecheck && npm test && npm run lint` 绿;评审基线 = 本票第一个实现
commit 之前的 HEAD。web 侧不动(BookshelfPage 仍按文案比较,server body 仍含
原文案,单一 commit 内不破坏任何消费方)。

## Comments

Done in 81063ec. wire.ts is types-only (four `export type`, zero runtime
exports); the two unions moved verbatim with their comments; all six codes
landed; the ladder uses `satisfies ImportRejection`; UNSUPPORTED_FORMAT is
annotation-typed as the ticket asked. 413 derives its MB figure from
MAX_UPLOAD_BYTES. Contract suite + pdf-import.test.ts extended in the same
commit. Review note (Standards axis): the four `instanceof` branches
differ only in {class, status, code} — table-driven collapse is candidate
5's deliverable (「错误梯塌缩成数据」), deliberately not done here.
