# 01: PDF 词级坐标验证 spike

**What to build:** 一个可运行的验证页，回答一个问题——在 pdf.js 渲染的 PDF 上做词级音标行叠加是否可行。样本 PDF 须含多栏、断字、缩放场景；音标数据用小型 fixture 即可。判定结论（原位可行 / 降级提取重排视图）写入本票 Comments，06 票按判定执行，不阻塞 EPUB 线。

**Blocked by:** None (can start immediately)

**Status:** done

依据：spec（.scratch/extension-reader/spec.md）PDF 决策；判据三轴=遮挡/对齐/开关。

- [x] 验证页加载含多栏、断字、缩放的样本 PDF 并完成渲染
- [x] 至少一段正文完成词-坐标映射并以音标行叠加演示
- [x] 三轴判据逐条记录结果：不遮挡正文、词对齐正确、可开关
- [x] 判定结论写入本票 ## Comments（原位 or 降级重排，附样本与复现步骤）
- [x] 只读验证：不改服务端与共享包任何行为

## Comments

**收官(2026-10-28,实现会话)——判定:原位可行**(06 按原位叠加落形,附两条件)。

- **复现步骤**:
  1. `npx tsx scripts/make-spike-pdf.ts`(生成 spike/sample.pdf,确定性,双栏+断字+平段)
  2. `npm run build:spike --workspace @lingualeaf/extension`(dist-spike/,不入库)
  3. 任一静态服务器伺服 apps/extension/dist-spike,开 spike.html,选 sample.pdf
  4. 判据读数:页面内 .spike-word/.spike-ipa 几何;三张截图在 .scratch/extension-reader/evidence/(100%/隐藏/150%)
- **三轴判据实测**(真 Chromium CDP 驱动):
  - **词对齐正确 ✓**:62/62 有音标词的词-音标中心偏差 ≤0.01px(构造上 IPA 以词 span 为定位祖先取 left:50%,坐标链 Util.transform(视口矩阵,item 矩阵) + 行内 charWidth 线性分摊与 pdf.js textLayer 同近似);150% 缩放后 62/62 保持,词位随 (x−16)×1.5+16 精确缩放——叠加层随视口缩放无漂移。
  - **可开关 ✓**:复选框一键 body.hide-ipa → 全部音标 display:none,词命中层保留。
  - **不遮挡正文 △(缓解后成立)**:16pt/11pt=1.45 行距下基线之下无自有空带,IPA em 盒与下一行相撞 46 处(有量测);缓解=半透明底 chip(0.62em,furigana 阅读器惯例),正文透过 chip 可读,截图为证。**06 落形条件一:音标行须带半透明底 chip;行距更紧的文档遮挡加重,接受度由人工在 07 验收定夺。**
- **附带实测结论**:多栏 42/31 词分列无漂移(栏间距保持);断字 exam-/ple 成两个独立 token——前带 fixture IPA、后留空,跨行合并词的 IPA(合并后查 example)留 06 决策,不阻塞;缺词 11 空槽排版不乱(缺词留空契约同离线词典);renderToken 丢弃缩放连点的旧渲染(竞态实测存在)。
- **边界记录**:样本只含单页无旋转文本;旋转/竖排文本的 transform 夹角处理留 06(若遇到再验);pdf.js worker 以 ?url 资产随构建发射,vite 打包无阻碍。
- **只读承诺兑现**:服务端与共享包零 diff(本票全部改动在 apps/extension 与 .gitignore/eslint ignores 的 dist-spike 例外)。全仓 verify 绿(421 测)。
