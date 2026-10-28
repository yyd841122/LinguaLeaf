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

全部数据在 `chrome.storage.local`：生词本状态、导入的书、阅读进度、最近文档。
没有任何同步、上报或网络请求（构建产物可断网使用）。卸载扩展 = 数据全清。

## 边界

- **扫描版 PDF**（无文本层）明确拒绝：《书》只收文本层完好的文档；
- **加密 / DRM 档案** 无法导入（EPUB 加密与 PDF 口令保护均明确报错）；
- **损坏档案** 在导入时明确报错，阅读页保持可用；
- 超大文件受内存约束（个人使用量级无碍）；PDF 逐页按需渲染，千页书一次只渲一页；
- 行距紧凑的 PDF 页，音标以半透明底色叠于下一行 ascender 区（ticket 01 判定）；
- EPUB 之外的网络文档、txt、docx、网页划词不在范围（ADR-0006）。
