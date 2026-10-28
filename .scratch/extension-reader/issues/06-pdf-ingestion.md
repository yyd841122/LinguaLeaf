# 06: PDF 接入（按 01 判定落地）

**What to build:** 文本层完好的 PDF 在扩展阅读页可读可标：按 01 票判定落形——判定通过则 pdf.js 原位叠加音标行，不通过则提取重排视图（文本流），两条路都走同一标注管线；扫描版 PDF 提示不支持；大书按章渐进。

**Blocked by:** 01、03

**Status:** done

依据：spec PDF 决策；GLOSSARY 书（文本层完好方可导入）。

- [x] 文本层完好 PDF 打开可读，含多栏与断字样本
- [x] 按 01 判定落形：原位叠加或提取重排，音标行与 EPUB 同管线
- [x] 扫描版 PDF 得到「不支持」明确提示
- [x] 大书按章渐进加载
- [x] 测试：fixture PDF 过链（先例：服务端 pdf 导入测试；pdf.js 使用注意 destroy、连字归一、裁剪框）

## Comments

**收官(2026-10-28,实现会话)**:全仓 verify 绿(425 测试),真 Chromium 冒烟全过。

- **落形**:01 判定原位可行→`src/reader/pdf.ts` 共享引擎(spike 引擎转正),PDF 以
  phase 'pdf' 进入阅读页:单页画布按需渲染(大书渐进是形状自带——千页书一次只渲一
  页)+ 翻页/缩放/音标开关;词span 带 data-word,弹卡 seam 与 EPUB 全同;音标查询
  走同一离线词典(同管线 ✓)。doc.destroy() 于离开时调用(worker 泄漏防线,01 票
  注意事项兑现);逐页 page.cleanup()。
- **扫描版检测**:前 3 页平均文本长 <15 字符→scanned-pdf 拒绝;均值而非全有——
  空白封面页不冤枉真书(jsdom 测试钉住)。加密→PasswordException→encrypted-pdf
  文案;损坏→InvalidPDFException→损坏文案。
- **真 Chromium 冒烟**:多栏+断字+2 页样本打开(73 词,真词典 ˈðə,元数据题名
  「Two columns, one question」——pdf-lib setTitle 被读到),翻页 1/2→2/2,
  开关摘除/恢复,词点击弹卡(woke→学习中),扫描版文案/损坏文案各就位。
- **连字与裁剪框(票面注意事项)**:连字——样本未造 ToUnicode 连字,渲染层无归一
  需求(getTextContent 默认 NFKC,与 01 票记档一致);裁剪框——样本标准 MediaBox,
  CropBox 非默认的文档留待真实文档验收(07)如遇再记。
- **边角三枚**:smoke 伺服器 MIME 表漏 .mjs(pdf.js worker 资产以 module 加载,
  octet-stream 被 Chrome 拒——真扩展 origin 无此问题,纯测试机问题);切换 showIpa
  的重渲染是异步的,断言须等 span 消失/再现;**stale dist 第三次咬人**(文案改后
  未 rebuild 就冒烟,读到旧文案)——07 的整装验收前必须 rebuild。
- **断字 token 决策(01 留下的)**:exam-/ple 保持两 token,前带 IPA 后留空;
  跨行合并查 example 留待真实阅读需求出现再议(另票候选,不阻塞)。
- **PDF 不入最近文档**:bytes 持久化(chrome.storage 需 base64 或 OPFS)未做,
  重开扩展后 PDF 需重选文件;EPUB 照旧。同上留另票候选。
