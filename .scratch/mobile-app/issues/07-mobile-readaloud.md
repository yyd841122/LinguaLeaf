# 07 听书 MVP:系统 TTS 连续朗读 EPUB
Status: ready-for-agent(2026-11-09 立票;第二批;/to-tickets 补全轮重编号,原 06)
Blocked by: 06

## 目标

听书(GLOSSARY:连续朗读全书;与「发音」严格分开)MVP:系统 TTS 引擎,EPUB 句子块序列连续朗读,阅读进度跟随。

## 范围

- 原生 TTS 插件接系统引擎;同一插件回填「发音」speakWord——现实现 packages/reading-model/src/speak.ts:6 走 window.speechSynthesis,WebView 可靠性先真机实测,可用则不动
- 连续朗读:句子块序列(原文行),暂停/继续/上下句跳转/语速
- 阅读进度跟随朗读推进(D6);当前句高亮
- 听书 UI:播放/暂停/上下句/语速控制条
- PDF 听书按页面文本行序朗读(已知差异,ADR-0008);体验不可接受则降级,记 needs-triage 存根票,不阻塞 EPUB

## 验收门

- 根 verify EXIT=0
- 真机【人验】:EPUB 连读一章不卡断;调速/跳句即时生效;退出重进,阅读进度回位
