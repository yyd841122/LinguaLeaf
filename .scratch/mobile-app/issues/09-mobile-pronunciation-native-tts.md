# 09 发音真机回填:WebView speechSynthesis 静默 → 原生 TTS 插件
Status: ready-for-agent(2026-11-09 维护者拍板 A:提前立,排 06 收口前实现;07 听书复用同插件)
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
