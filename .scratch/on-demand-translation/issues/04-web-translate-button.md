# 04 · 阅读页翻译按钮与未译章渲染

Status: ready-for-agent

## Scope

- ReadingPage 工具栏第三按钮(目录|显示设置|翻译),作用于当前章,按状态变形:
  untranslated →「翻译本章」;translating →「翻译中 N%」禁用 + 1.5s 轮询
  (照书架 IMPORT_POLL 先例);translated/failed →「重新翻译」,failed 额外
  显出 translation_error;点击直接重翻,无确认弹窗。
- 409(同章 in-flight 双击竞态)走既有 catchable ApiError 路径提示。
- 未配置翻译服务(可用性来自票 03 的载荷):按钮置灰 + 提示,不隐藏。
- 整章零译文:译文行不渲染,ReadingSettings 的译文行开关置灰;个别句 NULL:
  维持现状空占位行(SentenceBlockView 的 translationText ?? "" 分支不动)。

## Gate

`npm run typecheck && npm test && npm run lint` 绿(看退出码);随后
`npm run verify` 全绿。基线 = 本票首个实现 commit 之前的 HEAD。行为信封:
既有 reading/契约 web 侧断言零删除零改写;新钉 = 整章零译文不渲染 + 开关
置灰、按钮三态变形、409 竞态提示。
