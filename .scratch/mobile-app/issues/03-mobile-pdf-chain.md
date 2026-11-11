# 03 PDF 链:断网真机读 PDF 全链路
Status: ready-for-agent(2026-11-09 /to-tickets 补全轮拆分)
Blocked by: 02

## 目标

PDF 阅读链路在真机启用:导入文本层完好的 PDF → pdfjs 坐标叠加音标 → 查词/生词/进度/书签/笔记与 EPUB 同权。

## 范围

- pdfjs-dist(^4.10.38)worker 在 WebView 的路径/打包处理
- pdf 三 store(pdf-position / pdf-notes / pdf-fingerprint)+ idb-bytes-store 真机启用与验证(02 已随迁)
- PDF 导入入口与书架接入(02 已备形状)
- 已知边界:扫描件不支持(既有导入边界);PDF 无句子块/章节 → 无按需翻译、听书按行序(spec Out of Scope / ADR-0008)

## 验收门

- 根 verify EXIT=0
- 真机【人验】:导入文本层完好 PDF → 坐标叠加音标 + 点词查详情 + 进度/书签/笔记;飞行模式重复;杀进程重开仍在

## 用户操作项(人做)

- 准备一本文本层完好的 PDF 传入手机
- 飞行模式与杀进程重开验证

## Comments

### 2026-11-11 领票前注(编排会话留档,clear 前固化)

验收门含「书签」,但手机端书签现为空集(票 10 needs-triage,扩展基座无可
搬)——与 05 领票前注同源的顺序茬,05 那边已留档、03 这边此前漏记。领票前需
先拍板票 10,二选一:(a) 10 提前排;(b) 03/05 照写、书签项后补,10 排 06 前。
后续拍板与选择记回本节。

**拍板回写(2026-11-11)**:维护者选 **(a) 提前**,票 10 已翻
ready-for-agent(Lane B)——EPUB 书签先行落地,本票门内「书签」届时原样可
过:PDF 接入以 10 的 bookmark-store 扩 page 目标(见 10 票面范围节),门文本
不改。顺序茬解除。
