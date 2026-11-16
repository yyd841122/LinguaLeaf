# mobile 书签两缺陷:面板加载清空正文记号 + 打签落位含 plain 块

**Status:** claimed

来自 mobile-app 10 独立终审发现 1+2(2026-11-16,threadId
01a1e1e2-b13e-7d73-b20d-c51c8a08fc1e,verdict NO-GO;终审内存探针确认,
编排侧已现场核验站点):

1. `EpubReader.tsx:368`:打开书签面板 `setBookmarkRows(null)` 清共享
   状态——正文记号同源派生,若列表未读完成就关闭面板,cleanup 撤票后
   记号持续消失(1→0,持久化书签仍在),违反票面「面板关闭记号仍在」。
   修法:加载态与最后成功快照分离;补「已有记号→慢读/失败→关闭」测试。
2. `EpubReader.tsx:64`:`topmostVisibleBlockIndex` 遍历全部
   `[data-block-index]`,而 `EpubChapter.tsx:123` 给 sentence/raw/code/
   image 都挂锚 → 可打出非 sentence 块坐标,违反票面落位契约。修法:
   按块种类+可见几何定位;补混合块 fixture。

## Comments

- 2026-11-16 立票。两缺陷在票 10 翻 done 的 eec9ac7 即存在,非后续票引入。

- 2026-11-16 追加(mobile-app 03 终审发现 2,threadId
  01a1e1ea-a7e2-72c1-83c8-a5dda0a47c67):PDF 面同款病——
  `PdfReader.tsx:254` 打开书签面板先清共享快照,慢读期间关闭 → 正文记号
  1→0→0 持续消失、存储仍有签。修法同 EPUB 面:加载态与快照分离,两站点
  一票同修。

- 2026-11-16 Lane A 实现(Codex 审核排队,同 backup-integrity 票一起等
  配额重置):commit ef932b4(基线 8a463f0)。EPUB+PDF 两面板同修:
  panelRowsLoading 与共享快照分离,快照不再被 open 清空,cleanup 撤票只
  撤面板读;失败旗出错误行时等待行让位、已落地行保持列出(比旧行为多
  一层:失败不再把面板打回「读取书签中…」空转)。落位改
  topmostVisibleSentenceIndex(chapter 数据过滤 kind),进度行走不动。
  新测试 5 片,变异心证:还原 src 后 5 红全数咬合(既有 stale-outvote
  测试不变绿);全量 verify 108 文件 1205 测试绿。人验项(真机慢读关闭、
  混合块打签)挂账等机检。
