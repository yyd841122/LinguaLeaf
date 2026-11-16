# mobile 书签两缺陷:面板加载清空正文记号 + 打签落位含 plain 块

**Status:** needs-triage

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
