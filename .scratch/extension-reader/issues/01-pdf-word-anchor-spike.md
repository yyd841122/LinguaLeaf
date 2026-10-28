# 01: PDF 词级坐标验证 spike

**What to build:** 一个可运行的验证页，回答一个问题——在 pdf.js 渲染的 PDF 上做词级音标行叠加是否可行。样本 PDF 须含多栏、断字、缩放场景；音标数据用小型 fixture 即可。判定结论（原位可行 / 降级提取重排视图）写入本票 Comments，06 票按判定执行，不阻塞 EPUB 线。

**Blocked by:** None (can start immediately)

**Status:** claimed

依据：spec（.scratch/extension-reader/spec.md）PDF 决策；判据三轴=遮挡/对齐/开关。

- [ ] 验证页加载含多栏、断字、缩放的样本 PDF 并完成渲染
- [ ] 至少一段正文完成词-坐标映射并以音标行叠加演示
- [ ] 三轴判据逐条记录结果：不遮挡正文、词对齐正确、可开关
- [ ] 判定结论写入本票 ## Comments（原位 or 降级重排，附样本与复现步骤）
- [ ] 只读验证：不改服务端与共享包任何行为
