# 04 — PDF 页码行按钮缩小 + 书架书名手动改名

Status: done

## 现象（用户 2026-11-16 round 4）

1. PDF 阅读面页码处（上一页/下一页）按钮太大占空间。
2. 导入的书名取了 PDF 元数据标题（如「www.i-enet.com」）不正常显示，
   要求允许手动改名。

## 修法

1. `.reader-pager button` 域内豁免 44px 触控底线（笔钮/听书行/状态药丸
   同款第四例）：视觉 ~28px（0.85rem）+ `::after` 命中区补偿。两个按钮
   分居页码两侧、横向余量大，横向外扩安全。EPUB 面共用此类（上一章/
   下一章）同步变小——用户三连反馈皆指向底线虚胖，两面一致。
2. `PdfBytesStore.rename(docId, title)`：走既有 mutate 队列；校验
   （trim 非空、长度上限）；记录整读整写（保留 storedAt/size/blob，
   元数据+字节原子性由后端 put 保证）；blob 缺损拒改。
3. `PdfShelf` 每行加「改名」钮 → 共享 overlay（overlay-veil/card 既有
   形）：输入框预填当前名，保存走 settle 通道，成功 refresh 书架并关
   窗，失败行内错误留窗可重试。行网格加一列。
4. touchPolish 钉页码行豁免；store 测试（改名保序/空名拒/坏记录拒/
   失败不落）；PdfShelf 面测（改名全流程/取消/空名/失败重试）。

## 验收

- 真机：PDF 面页码行按钮 <44px 且可点；把「www.i-enet.com」改成
  「Candide 老实人」，书架与重开书名跟随。
- 根 npm test 全绿。

## Comments

**2026-11-16 实现 + 真机机检**

- `PdfBytesStore.rename`（mutate 队列内整读整写,保 storedAt/size/blob,
  坏记录拒改）+ PdfShelf 行「改名」钮 + 共享 overlay（预填/空名锁存/
  settle 失败留稿重试）+ `acceptPdf` 增 storedTitle 位：重开时存储名
  压过 PDF 元数据名（两个旧面测断言按新规则翻新,另有面测钉住）。
- `.reader-pager button` 紧凑豁免（第四例,双向命中区;EPUB 上一章/下一
  章同步受益）。
- 真机（360×748,raw CDP）：书架「www.i-enet.com」经真实 UI 改名
  「Candide 老实人」→ 重开阅读面标题跟随「Candide 老实人」；页码行
  44→28px×2 钮。截图 evidence/pdf-rename-pager-360.png。
- 根 npm test 112 文件 1273 过|3 skipped（一次孤发 note-popup 时敏抖动,
  单跑+全量复跑双绿,系既有负载抖动模式,与本改无关）。
