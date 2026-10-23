# 03 · 章级翻译路由与后台任务

Status: ready-for-agent

## Scope

- `apps/server/src/books-router.ts` 新路由
  POST /api/books/:id/chapters/:chapter/translate:respondIfNotReady 先行;
  章 translation_status = 'translating' 时 409(新守卫,样式照抄
  respondIfNotReady);否则置 translating、202 返回章载荷,`void` 起后台任务。
- 后台任务复用 `translateChapters`:章内句子平铺、20 句一批、失败句 3 轮
  重试留空(「留空」语义在此延续);按句计数回调经票 01 助手写 percent;
  收尾置 'translated'/'failed',错误路径照 import-task 的 catch-settle 模式。
- 章内容 GET 载荷增发 translationStatus(与 translation_error);
  翻译服务可用性随现有载荷暴露(挂点实现时定,不建新配置端点)。
- 契约测试加盖:409 家族新成员(书未 ready / 同章 in-flight)、202、
  后台完成后的状态迁移、载荷新键;两章同时 translating 合法(跨章不互斥)。

## Gate

`npm run typecheck && npm test && npm run lint` 绿(看退出码);随后
`npm run verify` 全绿。基线 = 本票首个实现 commit 之前的 HEAD。行为信封:
409 家族只加盖新成员,既有四条断言不动;新钉契约 = 同章 in-flight 409、
202、translationStatus 上载荷。
