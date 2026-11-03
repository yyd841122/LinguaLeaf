# pdf-word-keyboard:PDF overlay 词单元无键盘路径

Status: needs-triage

来源:annotated-blocks-kernel 立票评审(Codex review-plan,threadId
`01a19f8f-0a34-7640-95df-db4e46164768`)发现,2026-11-03 现场复核成立。

## 问题

ext PDF overlay 的词单元(pdf.ts:218-219)带 `role="button"` +
`tabindex="0"`——可聚焦、自述可按,但容器只有点击委托
(ReaderPage.tsx:749 onOverlayClick、:788 onClick),没有任何键盘处理:
Enter/Space 落空。web/ext 章节 reader 的同名词单元都有 Enter/Space → 查词
(web ReadingView.tsx:200-213,audit 2026-10-23 补的正是这条;ext
ReaderPage.tsx:471-483)。PDF 词单元是 a11y 承诺(role + tabindex)与行为
的半悬空态。

## 开放决策(拍板后升 ready-for-agent)

1. 收编形态:复用 annotated-blocks-kernel 的委托工厂(若已落地),还是
   PDF 自带轻量 keyDown(overlay 词坐标是 DOM 绝对定位,弹窗锚点取词框
   矩形,与章节 reader 同构)?
2. 锚点几何:PDF 词框是 transform 过的绝对定位 span,`getBoundingClientRect`
   是否给出弹窗可用的屏上矩形(真机抽验)。
3. 是否顺带核对 pdf-word:hover 的既有静音规则(reader.css:154)与键盘
   focus 样式的搭配。

不阻塞 annotated-blocks-kernel:该票范围已明确排除 PDF(其 plan.md §1)。
