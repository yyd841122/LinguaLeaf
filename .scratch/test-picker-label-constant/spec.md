# 手机测试:picker aria-label 字面量批扫为共享常量

**Status:** needs-triage

来自 mobile-md-import 票 02 双轴评审 Standards 轴(judgement call,非硬违规;
2026-11-15)。「选择 EPUB、PDF 或 Markdown 文件」这一 picker aria-label 以字面量
散布 6 个 mobile 测试文件共 14 处(readerPage / App / pdfReflow×2 /
pdfReaderBookmarks / readerNotes×2 / pdfReaderNotes×7)。本次改名即机械同步 13 处,
duplication 的维护成本已实证一次。

问题:字面量重复,下次改文案仍是 shotgun surgery。
候选解:测试侧共享常量或 picker 植入 helper(repo 先例:CODING_STANDARDS 认可的
共享查询 helper 形状)。

开放决策:apps/mobile/test 目前没有共享 helper 模块——为一个标签立一个值不值,
还是连同其它跨文件测试字面量(如有)一起批扫。照 CODING_STANDARDS「Structural
twins of an available named type sweep in a batch, not per diff」:不在功能票内
顺手做,攒一批一起扫。

## Comments

- 2026-11-15 mobile-md-import 票 02 评审发现立票(Standards 轴 finding 1)。
