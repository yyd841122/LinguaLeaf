# 13 全量负载时敏断言加固清扫(vitest 负载竞态族)
Status: needs-triage

## 背景与问题

2026-11-14/15 票 03 人验期间,pre-commit/verify 全量套件在负载下四度
抽中不同文件的时敏断言(孤发均复绿,签名一致——渲染/读取链 settle 晚
于同步 getBy/getByRole 断言一个 state update):

1. ticket 10 既有记档:readerBookmarks.test.tsx 尾段 findByText 1000ms
   顶满(2026-11-13 pre-commit 首例;11-14 再现,回记票 10)
2. pdfReaderBookmarks.test.tsx 长按案:pointerDown 早于 lineGeo 落地,
   长按拿空几何静默不触发(11-15,已加固:笔钮 enabled 门)
3. pdfReaderNotes.test.tsx drift 案:getByRole("alert") 早于 setDrift
   落地(11-15 pre-commit,已加固:findByRole)
4. (第 1 例之外的潜在面:同族「同步 getBy 时敏断言」在
   pdfReaderNotes/pdfRendering 尾段仍有存量)

## 待拍板

是否立案做一次加固清扫:全仓时敏断言按「时序相关一律 findBy*/等待
settle 信号」体检修一遍(工单量:预计 ~10 处以内);或维持现状按例
加固(每例都是全量门一掷约 50% 的噪音)。

来源:票 03 人验 round 7 期间第 3/4 例记档后立票。

## Comments

**2026-11-16 数据点(mobile-ipa-buttons 04 收官全量跑)**

- 孤发 1 红:`pdfReaderNotes > restores markers after zoom/IPA rebuild`
  的 note-popup `toBeNull()` 同步断言赶空窗;单跑绿 + 全量复跑绿(双
  证),未改动该测试。同文件同族时敏断言是本票已知模式,清扫时此条
  应一并 findBy 化。触发背景:全量并行 + 当日本会话新增 5 测(负载
  边界又移)。
