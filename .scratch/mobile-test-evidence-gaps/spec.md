# mobile 测试证据缺口批扫:词汇后端 catcher / 落点断言 / 字典资产门

**Status:** needs-triage

来自 mobile-app 02 独立终审发现 4+5+6(2026-11-16,threadId
01a1e1db-a5d2-75f0-9f2f-1c7b4accd86b,变异心证证据缺口簇):

1. 生产词汇后端接线和真实落盘路径无变异 catcher:默认后端换 memory 或删
   `vocabulary-store.ts:143/151` 的写入,现有词汇行为测试仍全绿。补默认
   组合根 + 真实词汇后端跨实例读回测试。
2. 打签/跳签/块内恢复无准确落点断言:`readerBookmarks.test.tsx:174` 仅
   断言 `block >= 0`;打签恒为块 0、删 scrollIntoView 均无 catcher。植入
   可区分块几何并断言精确目标。
3. `dictionaryAsset.test.ts:39`:CI 适配把「任一资产缺失」变成字节测试
   跳过,原终审 mutation 防线退化(当前两资产在且逐字节相同,门缺口
   非数据缺口)。建立资产必须存在的检查门,禁止静默跳过。

## Comments

- 2026-11-16 立票。

- 2026-11-16 追加(来自 mobile-app 10 独立终审,threadId
  01a1e1e2-b13e-7d73-b20d-c51c8a08fc1e):④跨章跳回不观测滚动,删
  scrollIntoView 仍绿(readerBookmarks.test.tsx:193);⑤落位 fixture
  rect 全零、只在第一章打签、面板无多行顺序案例(readerBookmarks.test.tsx
  :156);⑥视觉仅断 .block-marked class,飘带/页边紫条样式可删仍绿、
  换书换章无带可区分陈旧结果的直接回归(:248)。

- 2026-11-16 追加(来自 mobile-app 05 独立终审,threadId
  01a1e1e9-f7c3-7550-927e-9e06deee6655):⑦web 导出测试以 "{}" 冒充备份
  只断文件名,contract suite 无备份端点覆盖——真实下载字节应能通过手机
  validator/manager(bookshelf.test.tsx:672);⑧merge 测试未预置仅本地
  生词/他书进度/异位书签,导出 fixture 未覆盖完整词状态与非首句译文落点,
  「保留 vs 清空」无区分 fixture(backup.test.ts:202)。

- 2026-11-16 追加(来自 mobile-app 03 终审,threadId
  01a1e1ea-a7e2-72c1-83c8-a5dda0a47c67):⑨分段阈值簇无 catcher——
  1.45→1.4、1.05→1.12 四组分段夹具全不变;壳高改 innerHeight/删 resize
  无 catcher;适宽禁用无 main 夹具时 400px 容器 368→300 不可测;行 span
  display:block(连续流退化为块)现有断言全不变;pinch/缩放钮作用域/
  跳签滚动无性质断言(pdfRendering.test.ts:58、pdfReflow.test.tsx:183);
  ⑩长按测试未派发松手后 click,「吞掉点词」断言无法区分删掉抑制逻辑
  (pdfReaderBookmarks.test.tsx:269、pdfReflow.test.tsx:249);⑪长按用
  字面量属性选择器查词,违反大小写约定(pdfReflow.test.tsx:245,P3)。
