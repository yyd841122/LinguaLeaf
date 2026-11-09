# 02 阅读器搬移:扩展 reader/store 进 mobile,离线全链路真机可用
Status: ready-for-agent(2026-11-09 立票)
Blocked by: 01

## 目标

扩展 reader 模块与 store 层整体搬入 apps/mobile;storage 后端换 WebView 等价物,离线词典资产进包。真机断网可完成 导入 → 阅读 → 标注 全链路。

## 范围

- 搬 reader/ 15 文件 + store/ 10 文件(spec 现状事实有清单);扩展本体不动(D12)
- **替换面已核**:四 store 的 chrome.storage.local(library / namespace-record / notes / vocabulary)+ ReaderPage 的 chromeBackend 注入工厂(:153)。后端方案二选一票内定:Capacitor Preferences 或纯 IDB(倾向少一个原生插件);mobile 侧提供非 chrome 的后端工厂注入
- idb-bytes-store / pdf-position-store / pdf-notes-store 零 chrome 直呼,预期原样可用;真机验证 IndexedDB 持久性(WebView 存储,杀进程不丢)
- dictionary.json(14,943,187 字节)进 mobile 资产,复用烘料产物不改脚本;若实现中必须动烘料,再生步骤明写
- pdfjs-dist(^4.10.38)worker 的 WebView 路径/打包处理
- 文件导入入口:先验 `<input type=file>` 在 Android WebView 是否拉起系统选择器;不可用再换文件插件,替换记录进票
- 路由:BrowserRouter 在 Capacitor scheme 下改 HashRouter 或 base 调整,方案票内定

## 验收门

- 根 verify EXIT=0
- 真机【人验】:导入 EPUB → 逐词音标 + 点词查详情(含发音)+ 生词本四态 + 进度/书签/笔记;导入文本层完好 PDF → 坐标叠加标注;**飞行模式**重复全链路
- 持久性【人验】:杀进程重开,书/进度/生词/笔记仍在

## 用户操作项(人做)

- 准备一本真实 EPUB + 一本文本层完好 PDF 传入手机
- 飞行模式与杀进程重开两项验证
