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
