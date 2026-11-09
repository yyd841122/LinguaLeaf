# 03 翻译缝:DeepSeek 客户端直连 + 设置页 key 管理
Status: ready-for-agent(2026-11-09 立票)
Blocked by: 02

## 目标

按需翻译(ADR-0004:按章、显式触发)在手机端直连 DeepSeek:移植服务端翻译逻辑纯 TS 部分,设置页运行时管 key,不编译进 APK。

## 范围

- 移植 apps/server/src/translate/deepseek.ts + batch.ts 的批次对齐/重试逻辑进 apps/mobile(纯 TS;不搬 Express 路由形状)
- 设置页:key / BASE_URL / MODEL 运行时填写;存储选型票内定(Capacitor 生态安全存储插件或等价;插件级选型不立 ADR)
- 章翻译触发 + 任务进度 UI:percent 可见步进、失败旗可读;异步落回走 settle-channel / 属主令牌不变量(CODING_STANDARDS 既有语义)
- 实现侧可用本地 OpenAI 兼容 mock 先验管线(BASE_URL 指 mock,零真实调用),再真机实测
- 扩展与 web 不动;翻译只进 mobile

## 验收门

- 根 verify EXIT=0
- mock 冒烟:percent 可见步进,零真实调用
- 真机【人验】:在线按章翻译出译文行、显示开关可隐;错 key 与断网各触发可读失败旗,不崩

## 用户操作项(人做)

- 设置页填入自己的 DeepSeek key
- 在线翻译一章 + 错 key + 断网三项验证
