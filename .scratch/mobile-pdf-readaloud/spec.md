# mobile PDF 听书:页面文本行序朗读(07 的降级存根)

**Status:** needs-triage

来自 mobile-app 07(听书 MVP)的票面许可路径:「PDF 听书按页面文本行序
朗读(已知差异,ADR-0008);体验不可接受则降级,记 needs-triage 存根票,
不阻塞 EPUB」。

- 现状:07 落地的 readaloud player 走 EPUB 句子块时间线;PDF 两侧面
  (画布/重排)均未接。接法候选:画布面用 renderPdfPage 的 lines 行序,
  重排面用 extractLines;跳句/进度跟随需按(页,行)锚映射回进度 seam
  (pdf-position-store),与 EPUB 的 blockIndex 语义不同。
- 拍板点:是否值得做(听书场景以 EPUB 教材为主)、做哪一面、进度锚映射。

## Comments

- 2026-11-16 立票(07 收官时按票面许可降级)。
