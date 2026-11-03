# pdf-word-keyboard:PDF overlay 词单元无键盘路径

Status: ready-for-agent

来源:annotated-blocks-kernel 立票评审(Codex review-plan,threadId
`01a19f8f-0a34-7640-95df-db4e46164768`)发现,2026-11-03 现场复核成立。

## 问题

ext PDF overlay 的词单元(pdf.ts:218-219)带 `role="button"` +
`tabindex="0"`——可聚焦、自述可按,但容器只有点击委托
(ReaderPage.tsx:621 onOverlayClick、:660 onClick),没有任何键盘处理:
Enter/Space 落空。web/ext 章节 reader 的同名词单元都有 Enter/Space → 查词
(web/ext 均走 annotated-blocks-kernel 的 createWordHandlers,见下)。
PDF 词单元是 a11y 承诺(role + tabindex)与行为的半悬空态。

行号备注: ReaderPage.tsx 行号系 annotated-blocks-kernel 迁移后
(commit 2fff857)重取;2026-11-03 复核,后续改动可能再偏移,以符号定位为准。

## 决策(2026-11-03 编排会话现场复核 + 维护者拍板,三项全定)

1. **收编形态: 复用 `createWordHandlers`**(annotated-blocks-kernel 已落地,
   packages/reading-model/src/react/annotated-blocks.tsx:127,含 onClick +
   onKeyDown: Enter/Space → preventDefault → 锚 `target.getBoundingClientRect()`
   中下)。障碍已排除: PDF 弹窗本就用同一 WordLookupPopup 锚 point
   (ReaderPage.tsx:373-380),setLookup 状态形状即 WordClick;工厂铺在
   pdf-stage 上,删 onOverlayClick 手抄体;PdfReader 回调 (word, point) 双参
   适配为 WordClick 单参。
2. **锚点几何: `getBoundingClientRect`**,抽验并入验收不阻塞动工。依据:
   scale 已烤进 JS 坐标(pdf.ts:204,`.pdf-stage` 无 CSS transform),
   getBoundingClientRect 给的就是真屏上矩形,与章节 reader 键盘锚同构。
3. **顺带补 `.pdf-word:focus-visible` 样式**。复核新事实: reader.css 零
   `:focus` 规则——tabindex 已使词可聚焦但焦点无视觉指示,系现存缺口。
   样式复用 hover 款半透明底色(reader.css:154 同款 rgba)。pdf-word 无
   word-settled 类,ADR-0005 hover 退底色逻辑不涉及它。

Lane: **B**(纯 TS/React、票面自包含、沙箱内可验证)。

不阻塞 annotated-blocks-kernel:该票范围已明确排除 PDF(其 plan.md §1)。

## 验收门

- 共享套件/宿侧测试: 键盘 Enter/Space 触发 onWordClick 且锚点取词框矩形
  中下;click 路径行为不回退(工厂 onClick 语义与现 onOverlayClick 恒同);
  pdf-ipa 子元素存在时 wordFromEvent 仍解析出词。
- 编排侧(caller)补跑 `npm run verify`,以退出码为门(tail 不作数)。
- **人工浏览器抽验**(收尾检查点,翻 done 前必做): ① Tab 聚焦 pdf-word 有
  focus-visible 半透明底色;② Enter/Space 弹窗锚在词框中下(即决策 2 的
  真机抽验,缩放 75%/100%/150% 各试一档);③ known/ignored 词键盘查词 +
  hover 行为与章节 reader 一致。

## Comments

### 2026-11-03 实现归档(编排侧,Lane B 完成)

- Codex 沙箱实现(gpt-6.1-sol/high,workspace-write,job
  `implement-mw0gkrt9-5c27m3`,threadId
  `01a1a0a4-5bc1-7ee0-800d-9a88d45e9079`),`.scratch` 零触碰,零 commit。
- 改动三文件: ReaderPage.tsx(工厂铺 pdf-stage、删 onOverlayClick 手抄体、
  onWordClick 改 WordClick 单参直通 setLookup)、reader.css(.pdf-word:
  focus-visible 同 hover 款半透明)、readerPage.test.tsx(+8 例)。
- 沙箱自报 typecheck/lint/定向测试绿;编排侧全链 `npm run verify`
  **EXIT=0**(48 files 619 passed | 2 skipped (621),基线 613 → +8 对齐)。
- 双轴评审(vs dca84fd):Standards **零硬违规**,3 条 judgement-call 记档
  不修——①hover/focus 两立规则字节同款声明(票面本义即复用同款;共享
  fragment 机制只收有消费点的 kernel fragment,ext 本地规则不收编);
  ②KeyboardEvent 内联构造重复(文件既有习语,先前已有 7 处同款);
  ③`useState<{word; point}>` 与 WordClick 孪生可提具名(既有共享声明,
  票面未请求,同上票 toAnnotatedBlock 处置)。Spec **零缺失零错实现**,
  3 条良性测试加座记档不修(负例测试、ipa 点击变体、focus-visible 钉挂
  settled-hover describe 下)。
- 保真度注: 负例「其他键与非词目标不响应」同时钉 preventDefault 不触发
  与 dialog 不挂载,非空洞断言。
- **待人工浏览器抽验(上方验收门三项,翻 done 前必做)**。
