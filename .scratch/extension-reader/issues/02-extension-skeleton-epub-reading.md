# 02: 扩展骨架：EPUB 打开到能读（无标注）

**What to build:** 从点扩展图标到读完一本 EPUB 的无标注骨架：选择或拖入文件 → 导入链 → 扩展阅读页分章渐进渲染。票内第一步验证服务端 EPUB 导入链的浏览器纯度（JSZip/DOMParser 皆浏览器原生，预期可复用）；若含 Node 专属依赖，把纯链等价搬移进共享包，服务端改为引入——只搬不改行为。错误路径面向用户明确报错，扩展保持可用。

**Blocked by:** None (can start immediately)

**Status:** claimed

依据：spec 导入链与错误路径决策；ADR-0006（无服务）。

- [ ] 点扩展图标出现入口，选择或拖入 EPUB 进入扩展阅读页
- [ ] 书按章节渐进加载，大书不整本卡死
- [ ] 导入链纯度结论记入本票 ## Comments；若提纯搬移，服务端行为零变更且全仓测试绿
- [ ] 加密/DRM、损坏档案分别得到明确提示；扫描版 PDF 按「书」词条提示不支持
- [ ] 测试：确定性 fixture EPUB 过全链 + 错误路径（JSZip fixture 建目录显式化，保证确定性）
- [ ] manifest 与 Vite 多入口构建就位，Edge load-unpacked 可加载
