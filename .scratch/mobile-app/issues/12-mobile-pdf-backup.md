# 12 PDF 侧资产进备份(pdf-notes / positions / bookmarks-page / bytes)
Status: needs-triage

## 背景与问题

票 05 记档「PDF 资产(pdf-notes/positions/bytes)本票不含:PDF 链条票 03
未落地;版本门留扩展位」。票 03 落地 PDF 链后新增同类设备本地资产:
PDF 书签(bookmark-store 的 page 目标行)。

现姿势:备份导出只含 EPUB 侧资产;PDF 侧(pdf-notes、pdf-position、
page 书签、pdf bytes)设备本地,换机/误删即失,与「学习者资产优先」
原则的张力待拍板。

## 待拍板

1. 是否值得为 PDF 侧资产 bump 备份版本(BACKUP_VERSION+1,wire 共享
   词表,涉及 server wire 类型 + 校验器扩展 + PC 导出路由连带核对)
2. PDF 原文件(bytes)是否进备份(体积可达数十 MB/本,格式需二进制
   外挂或 base64,票 05 未入);不进则恢复后书架空壳,需可读提示
3. PC 侧无 PDF:这些行只在手机↔手机迁移时有意义,是否走独立
   「手机全量导出」格式而非共享 wire

来源:票 03 领票(2026-11-14)实现期发现,备份导出过滤 page 行时记档。
