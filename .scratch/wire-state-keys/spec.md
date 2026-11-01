# wire-state-keys:chapter wire 带出 stateKeys(tokenStatuses 算出 key 又扔掉)

Status: needs-triage

来源:architecture-review-20261101 候选 3 的「可选进一步」;候选 3 纯函数
路径(status-join 票)拍板时明确:动 wire 是行为变更,另票待拍。本票是其
唯一入档载体(报告 gitignore)。

## 问题(现场取数,2026-11-01)

server `apps/server/src/vocab-store.ts:95-105` tokenStatuses 为每个 token 算出
`vocabularyStateKey(dictionary, normalizeLookupToken(token))` 再查表,算出的
key 随即扔掉;wire `SentenceBlockPayload`(`apps/server/src/wire.ts:61-73`)
只带 `wordStatuses` 位置数组——「顺序 = tokenizeWords 序」的不变量因此摊在
wire 注释(:68-70)、web 渲染(ReadingView.tsx:43-44)、web 补丁(status-join
票收编后为 reading-model 纯函数)三处散文。客户端每次状态变更都要重推 token
序对位。

扩展侧已证明另一形可行:stateKey 直接键控(ext ReaderPage 的 stateKey Map,
渲染免对位)。ADR-0005「前端渲染 verbatim、永不词形还原」:server 交 key 是
强化而非违背(评审报告结论)。

## 待拍决策(拍板后才升 ready-for-agent)

1. 是否动 wire 契约:`SentenceBlockPayload` 增 `stateKeys: string[]`(与
   wordStatuses 同序)还是改键值形;兼容面 = web ChapterPayload 消费 +
   server contract tests。
2. web 侧迁多少:补丁面(applyStatusToBlocks 的下游)改键控即可,还是渲染
   面一并弃位置 join;若渲染保持位置,则 key 只省补丁重推,不变量散文仍是
   三处变两处。
3. 触发条件:第二状态消费面出现(评审报告举 toast 跳转类)或 ADR-0005 方向
   再推进时优先重议;没有第二消费面之前,收益=不变量单处化,成本=wire 契约
   与双端改动。

## 证据

- server 算 key 即扔:vocab-store.ts:95-105 tokenStatuses。
- 扩展 stateKey 渲染可行已证:ext ReaderPage stateKey Map(offline 收录词
  也能落态,不依赖 wire)。
- 位置 join 已有单测落点(status-join 票落地后),本票的增量收益是消灭位置
  不变量本身,不是补测试。
