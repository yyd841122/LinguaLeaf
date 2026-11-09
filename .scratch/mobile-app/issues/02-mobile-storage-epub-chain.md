# 02 storage 后端替换 + EPUB 链:断网真机读 EPUB 全链路
Status: ready-for-agent(2026-11-09 /to-tickets 补全轮:原「阅读器搬移」拆为 02/03)
Blocked by: 01

## 目标

storage 后端经注入缝替换为 WebView 等价物,书架 + EPUB 阅读链路在真机打穿:断网可 导入 EPUB → 逐词音标 → 查词/生词/进度/书签/笔记,杀进程不丢。**tracer bullet 本票**:纯端侧的每一层(存储、导入、词典、UI)在此票首次贯通。

## 范围

- reader/ 与 store/ 模块搬入(15 + 10 文件清单见 spec 现状事实);扩展本体不动(D12)
- **替换面**:四 store 的 chrome.storage.local(library / namespace-record / notes / vocabulary)+ ReaderPage 的 chromeBackend 注入工厂(:153)→ WebView 等价后端(方案票内定:Capacitor Preferences 或纯 IDB,倾向少一个原生插件)
- idb-bytes-store / pdf-position-store / pdf-notes-store 零 chrome 直呼,本票随迁(03 启用)
- dictionary.json(14,943,187 字节)进 mobile 资产,复用烘料产物不改脚本;若必须改烘料,再生明写
- 文件导入入口:先验 `<input type=file>` 在 Android WebView 是否拉起系统选择器;不可用再换文件插件,替换记录进票
- 路由:BrowserRouter 在 Capacitor scheme 下改 HashRouter 或 base 调整,方案票内定
- PDF 站(ReaderPage 的 PDF host)随迁但**不启用**(03 打开);书架与 landing 形状保留

## 验收门

- 根 verify EXIT=0
- 真机【人验】:导入 EPUB → 逐词音标 + 点词查详情(含发音)+ 生词本四态 + 进度/书签/笔记;**飞行模式**重复全链路
- 持久性【人验】:杀进程重开,书/进度/生词/笔记仍在

## 用户操作项(人做)

- 准备一本真实 EPUB 传入手机
- 飞行模式与杀进程重开验证
