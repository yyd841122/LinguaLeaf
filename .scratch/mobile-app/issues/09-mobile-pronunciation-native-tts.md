# 09 发音真机回填:WebView speechSynthesis 静默 → 原生 TTS 插件
Status: needs-triage(2026-11-09 从 mobile-app 02 真机人验浮出:点词可点不响)
Blocked by: 无(选道/时点待 triage 拍板)

## 问题

mobile 02 真机人验(PCAM00/ColorOS)实证:点词弹窗发音按钮可点、
**不出声**。根因 = `packages/reading-model/src/speak.ts:6 speakWord` 走
`window.speechSynthesis`,Android WebView(Chromium)不带 TTS 引擎绑定,
合成语音静默无输出——spec 实现决策预判过的形态(「WebView 可靠性真机
实测后定,不可靠则原生 TTS 插件回填」),实测已裁:不可靠。

发音门在 02 验收门字面内(「点词查详情(含发音)」),故 02 保持
ready-for-human 未翻 done;本票承接回填后 02 再收官。

## 回填方向(spec 既有预案)

- 原生 TTS 插件(候选 @capacitor-community/text-to-speech 或等价),
  mobile 侧经缝把 speakWord 路由到原生——**共享内核 reading-model 不动**
  (spec 硬边界),缝落点(WordLookupPopup 调用面 mobile 化 or 注入)
  立票时定
- **同插件伺候听书**:07 听书 MVP 本就要加系统 TTS 插件(spec:
  「同插件伺候发音与听书」)——本票可提前立(第一批发音体验)或并入 07
  一次做,triage 拍板
- 备选(不推荐):依赖设备装 Google TTS 后 WebView speechSynthesis 可能
  复活——不可控且 CN 环境不可依赖,仅记录

## 验收门(立票后补全)

- 真机【人验】:点词发音出声;与听书插件复用关系按 triage 结论验证
