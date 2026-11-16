# 07 听书 MVP:系统 TTS 连续朗读 EPUB
Status: done(2026-11-09 立票;第二批;/to-tickets 补全轮重编号,原 06)
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

## Comments

- 2026-11-16 领票。阻塞说明:06 实现已落地(849dbba,评审等配额 17:43 +
  真机人验),本票控制条直接继承其 44px 底线与深色 token,先决面已实;
  06 评审若有修笔属视觉层,不影响本票缝。另:票面「speechSynthesis 真机
  实测」前置已被票 09 终审定案(WebView 内静默),原生 TTS 插件经 09 已
  就位——本票直接走 speak router 原生面。

- 2026-11-16 实现落地(commit,基线 849dbba):readaloud player(纯逻辑,
  延迟 promise 假 speaker 单元 6 片)+ EpubReader 接线(控制条/高亮/
  进度跟随/跨章跟随/滚动静默)+ native-tts 扩 rate/stop。面级 3 片,
  四变异咬合;verify 112 文件 1256 绿。PDF 听书按票面许可降级存根
  .scratch/mobile-pdf-readaloud/(needs-triage 待拍板)。语速 MVP 会话级
  (不持久化),起播点=当前章首句——两项如真机反馈需要再开票。Codex
  评审排 17:43 后(与 06 同批)。

- 2026-11-16 真机机检(10c6019 后全过):连读句推进+当前句紫底高亮可见;
  跳句/调速(1×→1.25×)即时;暂停高亮驻留、步进钮可用;杀进程重进
  回位到朗读停句处(非章首)。发现并修笔:听书条原在 header 外,恢复
  滚动在章中时入口不可达——挪进 sticky header 常驻(a11y 树里 WebView
  inline 笔钮报零界,dtap 不可用,直接坐标点按)。TTS 实声由用户侧
  听感确认(机检以高亮推进为证)。Codex 评审已发。

- 2026-11-16 Codex 审核(threadId 01a1e409-4fa1-7951-bc7c-f4769b19b4c7,
  基线 849dbba→10c6019):**NO-GO 2P1+2P2+2 Standards**,全修于 3e77d2d:
  ①中断续体竞态(旧操作 flush 晚落地借全局代际复活)——自有代际+
  stillMine 门,评审探针形测试钉住;②探针期 stop 停不掉(原生 stop 只
  清已提交朗读)——native-tts 取消纪元,陈旧探针静默不发;③手动换章
  {chapter,0} 与播放器争写进度——cursor 守卫;④暂停跨章跳句画面/高亮
  失联——章跟随扩 paused(滚动跟随之分记档);Standards:竞态测试原形
  不成立已重造(逐次门控 stop);「暂停朗读/朗读失败」归 GLOSSARY 改
  「暂停听书/听书失败」。四变异咬合;verify 112 文件 1263 绿。真机
  机检已过主体链,竞态类为评审探针所钉;TTS 实声听感留用户。收官。
