# format-reader registry:上传口的一个小 interface

来源:architecture-review-20261022 候选 5(Worth exploring · in-process)。
锚点为候选 1、4 落地后的现状(router 错误梯已是 {class, status, code}
`satisfies` 四连,评审点名这是本候选的塌缩对象)。

## 问题

`buffer + filename → PreparedBook | 客户端拒绝` 这个 interface 隐式存在:
router 的 if 链逐一认识三个格式谓词,catch 梯逐一认识四个错误类——
「上传坏文件客户端付出什么代价」摊在 router 与两个格式模块里。每接新格式
要同步改 if 链 + 错误梯 + 注册表(尚不存在)三处。

## 方案

注册表:各格式前半登记谓词 + reader,坏上传以归一化拒绝(稳定 reason
code + 文案)抛出;reason → status 一张表钉死;router 缩成数据驱动,
配合 book-store 后整个文件只剩 HTTP 信封。

- `apps/server/src/import/upload-rejection.ts`(新):`UploadRejected`
  (reason: ImportErrorCode + 文案)与 `REJECTION_STATUS:
  Record<ImportErrorCode, number>` 一张表。
- `apps/server/src/import/format-readers.ts`(新):`FormatReader`
  (accepts + read)、格式注册表、`readUpload(filename, content)`、
  `UNSUPPORTED_FORMAT` 信封(no-reader 与 router 的 no-file 共用)。
- epub.ts / pdf.ts:边界处原生错误类转换为 `UploadRejected`;
  EpubParseError / PdfParseError / EncryptedPdfError / ScannedPdfError
  四个类删除(它们的存在只为 router 分发,无任何测试直接引用)。
  响应体逐字节不变:「invalid EPUB: / invalid PDF: 」前缀随消息迁入
  格式模块,epub/pdf 各持一个本地前缀 helper。
- books-router.ts:if 链与错误梯删除,catch 收成一个
  `respondRejection` 响应路径;multer 的 LIMIT_FILE_SIZE 走同一路径。
- 新测试 `apps/server/test/format-readers.test.ts`:REJECTION_STATUS
  全表 toEqual 钉死;readUpload 对未知扩展名 / 坏 EPUB 的 reason 钉死。
  契约套件无需扩展(线上形状零变化)。

## 决策

1. **UploadRejected 与 REJECTION_STATUS 单独成模块**,不进 format-readers
   (epub/pdf 要抛它,registry 又要 import 格式模块——放 registry 会成环),
   也不进 wire.ts(候选 4 决策 2:wire 保持 types-only,HTTP status 映射
   是 server 侧知识)。
2. **错误类层级整个删除**而非保留内部类再转换:PdfParseError ←
   EncryptedPdfError 的继承只为让 router 区分它们;格式模块直接抛
   UploadRejected 后层级无存在意义。
3. **响应体逐字节不变**:契约套件、pdf-import、epub-import 的既有断言
   是本次重构的测试信封;线上形状零变化,无 web 侧改动。
4. 非尺寸类 multer 拒绝维持无 code 的原样(候选 4 评审已钉为既有行为,
   不在本次收紧);本候选重构触及该分支,按 CODING_STANDARDS 的 pin
   纪律补 characterization 测试(错误 multipart 字段名 →
   LIMIT_UNEXPECTED_FILE 裸回显)。

## 门禁

实现 commit:`npm run typecheck && npm test && npm run lint` 绿;收尾
`npm run verify` 全绿(看退出码)。评审基线 = 实现票第一个 commit 之前的 HEAD。
