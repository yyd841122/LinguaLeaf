# LinguaLeaf 浏览器扩展（扩展阅读页）

打开 EPUB / 文本层完好的 PDF 即得美式 IPA 音标标注的本地阅读页。按 ADR-0006：
全链路在浏览器内完成——无网络、无服务进程、无 API key；生词本四态（学习中 /
已掌握 / 已忽略）与阅读进度存在扩展本地，**卸载扩展即随浏览器存储一并消失**
（数据自决）。

## 加载（Edge，load-unpacked）

```sh
# 仓库根执行
npm install
npm run bake:dictionary --workspace @lingualeaf/extension   # 烘焙离线词典（见下）
npm run build      --workspace @lingualeaf/extension        # 产 apps/extension/dist
```

1. Edge 打开 `edge://extensions` → 打开「开发人员模式」；
2. 「加载解压缩的扩展」→ 选 `apps/extension/dist` 目录；
3. 点工具栏 LinguaLeaf 图标（或右键菜单「用 LinguaLeaf 打开」）进阅读页；
4. 选择或拖入一本 EPUB/PDF。

无词典资产时扩展照常可用，只是音标行全空（缺词留空契约）。

## 离线词典资产（构建期烘焙，不入库）

`public/dictionary.json`（约 14MB）由 `scripts/bake-dictionary.ts` 从服务端
词典数据库（`.data/dictionary.sqlite`，由仓库主线的两个 dict:import 脚本生成）
烘焙：美音 IPA 全量 + 词元映射全量 + IPA 覆盖词的中译。资产只存在于本机构建，
不提交仓库；换机器重新 bake 即可。

## 数据自决

生词本状态、EPUB、笔记、阅读进度与最近文档存在 `chrome.storage.local`；
PDF 原书副本和书架元数据存在扩展本地 IndexedDB。PDF 导入成功后自动入架，
重开可点书名继续阅读，无需重选文件；缓存打开不会重写原书副本。
书架的 × 直接删除原书副本，保留笔记和阅读位置；重选同一 PDF 可重新入架并回挂。
扩展每次打开阅读页会申请持久存储，未获准或申请失败不影响阅读；浏览器管理配额，
存满时显示行内提示，仍可选文件阅读。无需新增权限。
没有任何同步、上报或网络请求（构建产物可断网使用）。卸载扩展 = 数据全清。

## 边界

- **扫描版 PDF**（无文本层）明确拒绝：《书》只收文本层完好的文档；
- **加密 / DRM 档案** 无法导入（EPUB 加密与 PDF 口令保护均明确报错）；
- **损坏档案** 在导入时明确报错，阅读页保持可用；
- 超大文件受内存约束（个人使用量级无碍）；PDF 逐页按需渲染，千页书一次只渲一页；
- 行距紧凑的 PDF 页，音标以半透明底色叠于下一行 ascender 区（ticket 01 判定）；
- EPUB 之外的网络文档、txt、docx、网页划词不在范围（ADR-0006）。

## PDF 书架验证边界与真机检查点

`npm run smoke --workspace @lingualeaf/extension` 先验证原生 IndexedDB 的提交、
Blob 摘要、事务后期 abort 回滚、延迟失败与 reload 后免选重开，再覆盖完整阅读流程。
它在 localhost 使用真实 IndexedDB / Blob；`chrome.storage.local` 是 sessionStorage
假身，reload 只证明同一 localhost origin 下的持久性。此脚本不能证明扩展 origin
在关页或浏览器重启后的持久性。

调用方补跑全链 `npm run verify` 和上述 smoke 后，在 Edge / Chromium load-unpacked：

1. 导入文本层完好的 PDF，写四类型行笔记，翻到第 2 页，设为 150%；回到入口，
   确认 PDF 书架显示书名与第 2 页，EPUB 最近文档仍可打开。
2. **关掉扩展阅读页再从工具栏打开**，不选文件，点击 PDF 书架书名；
   确认页码、150% 缩放、四类型行笔记均恢复，点词查详情键盘操作与音标行仍可用。
3. **完整退出并重启浏览器**，再从工具栏打开阅读页；不选文件，点击同一书架项，
   再核对原书、页码、缩放与笔记。必须在真实扩展 origin 执行这一步。
4. 点击书架 × 无确认即移除书架项；重选同一文件，确认笔记、阅读位置回挂且书架重现。
   同文件重复导入只留一条；用另一 EPUB 核对其重开、音标行和四类型笔记。
5. 在测试配置中模拟配额 / 读 / 删除失败：存失败仍可读、读失败可重试且选择入口常在、
   删除失败原行保留；替换失败旧标题与 storedAt 不变。不要清空个人存储来模拟失败。

这些检查点尚需调用方执行；沙箱内的注入 backend 单测不能替代原生事务和真机证据。
