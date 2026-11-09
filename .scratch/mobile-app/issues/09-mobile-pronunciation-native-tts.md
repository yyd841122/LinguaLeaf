# 09 发音真机回填:WebView speechSynthesis 静默 → 原生 TTS 插件
Status: ready-for-human(2026-11-09 实现收官 c6c3b2e + 评审修正 dff3243;待真机人验两项)
Blocked by: 02

## 目标

点词查详情的发音在真机出声。02 真机实证 `window.speechSynthesis` 在
Android WebView 静默(按钮可点、无音频)——spec 实现决策的预案分支触发:
原生 TTS 插件回填,共享内核 reading-model 不动。

## 范围

- 原生 TTS 插件接入:候选 @capacitor-community/text-to-speech 或等价,
  **版本以领票时 npm 实际最新稳定为准**(票面不预写)
- **路由缝**:speakWord 消费面的 mobile 侧换缝,共享内核不动(spec 硬边
  界);缝落点实现时定并记录(候选:WordLookupPopup 调用面注入 speak 函数,
  or mobile 侧 speak 路由模块按 host 分派)
- 插件封装落 mobile 侧可复用位置,07 听书(连续朗读)只加句子序列层——
  同插件伺候发音与听书(spec 原文)
- 失败形态可见:引擎缺失/合成失败时 UI 出可读旗(CODING_STANDARDS:
  missing 和 failed 对读者是两回事),不静默不假成功
- 触控/安全区/深色不在本票(06 收口)

## 验收门

- 根 `npm run verify` EXIT=0(评审基线 = 本票首个实现 commit 之前的 HEAD)
- 真机【人验】:点词发音出声(默认音量/语速即可);发音失败时可见旗
- 真机【人验】:杀进程重开发音路径照常(资产门 02 已验,此处只验发音)

## 用户操作项(人做)

- 真机点词听声确认

## Lane(领票时定)

npm 安装 + gradle + 真机 adb 均涉及 → Lane A 倾向,领票时确认。

## Comments

### 2026-11-09 从 02 真机人验浮出立票

02 人验记录:点词可点不响(PCAM00/ColorOS,WebView speechSynthesis 静默)。
维护者三选项拍板 A:提前立票(排 06 收口前),不并入 07——发音是查词体验
的一半,第一批日用缺它明显;插件与缝一次做掉,07 只加连读层。备选「依赖
设备装 Google TTS 让 WebView speechSynthesis 复活」不可控且 CN 环境不可
依赖,仅记录不采纳。

### 2026-11-09 实现收官记档(Lane A:实现 c6c3b2e + 评审修正 dff3243,评审基线 b725b06)

- **缝落点拍板与记录**(票面候选 2「mobile 侧 speak 路由模块按 host 分派」):
  壳层 `WordLookupPopup` `onClickCapture` 拦截「发音」按钮(按无障碍名匹配,
  内核标记变化由 catcher 测试 `speakPopupRedirect.test.tsx` 钉死)→
  `src/speak/router.ts` 按 `Capacitor.isNativePlatform()` 分派:原生走插件封装
  `src/speak/native-tts.ts`(probe isLanguageSupported→speak;插件默认 Flush
  队列承内核「重复点击从头播」语义),浏览器宿主走内核 browser speakWord
  (经 `virtual:lingualeaf-kernel-speak` 虚拟 id,vite/vitest 各一行接线,
  内核零改动)。**曾先做 Vite resolveId 重定向内核 import 的变体并弃用**:
  vitest 对 workspace 依赖原生加载,vite-node 外置判定只放 bare specifier
  进管线,旋钮(vite 级与 test 级 server.deps.inline 正则/字符串、alias、
  moduleDirectories)全部无效——捕获拦截是纯运行时,vitest/构建同一行为。
- **插件**:@capacitor-community/text-to-speech **8.0.2**(领票时 npm latest,
  peer core>=8 与仓内 Cap 8.6.0 兼容);`cap sync` 注册进
  `android/capacitor.settings.gradle` + `app/capacitor.build.gradle`。
- **失败旗**:`SpeakRejectionError` 两态(engine-missing / synthesis-failed,
  probe 拒答或答否=缺引擎;probe 过后 speak 拒=合成败)→ 路由
  `onSpeakOutcome` 事件 → ReaderPage 常驻 `role="alert"` 旗,可 ✕ 关闭;
  **新成功清旧败旗**(settle 不变量,评审收编)。已知边界:browser 路径只
  捕同步抛,内核 API 缺失静默 no-op 属内核既定语义,异步 onerror 通道留后续票。
- **07 复用位**:`NativeSpeaker` 接口(src/speak/native-tts.ts)即插件封装缝,
  07 听书只加句子序列层。
- **门与测试**:根 `npm run verify` EXIT=0(评审修正后复跑仍 0);新增 17 用例
  (适配器分类 4、路由分派 6、虚拟映射 2、绑定 catcher 1、旗 2、ReaderPage
  集成 2),mobile 套件 220 全绿。
- **真机机检**(非人验门):PCAM00 装机,点词弹窗→点「发音」,logcat 实证
  `TextToSpeech.isLanguageSupported {"lang":"en-US"}`→`{"supported":true}`→
  `TextToSpeech.speak {"text":"words","lang":"en-US"}` 全链,屏上无失败旗、
  0 FATAL/E-chromium。评审修正后最终 APK 已重装并复跑通过。
- **双轴评审**(并行子代理,Standards/Spec 各一):Standards 无硬违反
  (判断题:两 config 路径双份、两处注释失真、无效 afterEach 归因——均修;
  NativeSpeaker 预留=票面 07 复用要求,保留;旗持久性——收编为成功清旗);
  Spec 六项全过,唯一低危(router 注释「whatever the path」失真)已按建议收敛。
  **Codex 独立审核未跑**(本会话以双轴子代理代行);如需补跑,基线 = b725b06,
  翻 done 前完成即可。

### 用户操作项(真机【人验】,设备在线、APK 已装评审后最终版)

1. **听单词发音**:打开书架上的「Mobile Smoke Book」→ 点一个英文单词
   (如 words)→ 在弹出的词详情卡里点右上角「🔊」。**应该**:立刻听到
   单词读声(默认音量/语速即可)。
2. **失败形态**(可选,正常设备不触发):只有设备没有可用语音引擎时,
   屏幕底部出现红色提示条「此设备没有可用的英语语音引擎…」,可点 ✕ 关闭。
3. **杀进程重开**:从最近任务划掉(或系统设置里强停)LinguaLeaf → 重新
   打开 → 重复第 1 步。**应该**:发音照常出声。

人验过了 → 本票翻 done;Codex 审核补跑与否一并届时定。
