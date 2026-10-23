# 01 · 注册表落地:错误梯与 if 链塌缩成数据

Status: ready-for-agent

## Scope

按 spec.md 方案全量实现。要点清单:

1. `import/upload-rejection.ts`:UploadRejected + REJECTION_STATUS。
2. `import/format-readers.ts`:FormatReader、READERS(epub/markdown/pdf,
   markdown 经 utf8 适配)、readUpload、UNSUPPORTED_FORMAT 信封。
3. `import/epub.ts`:删 EpubParseError,三处 throw 改 `invalidEpub` helper
   (前缀 `invalid EPUB: ` 迁入)。
4. `import/pdf.ts`:删三类,`invalidPdf` helper(前缀 `invalid PDF: ` 迁入),
   asParseError 返回 UploadRejected(encrypted 无前缀,与现状逐字节一致),
   扫描门直接抛 scanned-pdf;模块头注释重写(类梯队 → reason 词汇)。
5. `books-router.ts`:删十个格式相关 import 与 UNSUPPORTED_FORMAT 常量
   (MAX_UPLOAD_BYTES 留守——multer limits 与 413 文案都要用它),catch 收成
   respondRejection,multer LIMIT_FILE_SIZE 同路径;`!file` 用注册表信封。
6. `test/format-readers.test.ts`:REJECTION_STATUS 全表 toEqual;
   readUpload 未知扩展名 → unsupported-format、坏 EPUB → invalid-epub、
   坏 PDF → invalid-pdf(rejects.toMatchObject({ reason }))。

## Gate

`npm run typecheck && npm test && npm run lint` 绿,且既有契约 / epub /
pdf 测试断言零改动通过(响应体逐字节不变的证明)。
