# word-lookup-kernel:点词查详情弹窗内核两宿收编

Status: needs-triage

维护者执行序已定(2026-11-01):架构评审候选 2(jump-target-protocol,已收官)
之后的下一票。本票是 grilling 前的 stub:决策未锁,锁定后翻 ready-for-agent。
唯一入档载体——评审报告 `.scratch/architecture-review-20261101-111943.html`
被 gitignore,其候选 1 卡片 + Codex 勘误卡的全部承载内容已折入本票。

## 问题

点词查详情的交互内核存在两份手工同步拷贝:web
`apps/web/src/WordLookupPopup.tsx`(247 行)与扩展
`apps/extension/src/reader/WordLookupPopup.tsx`(254 行)经 diff 实测
196/247 行逐字节相同;`useOwner` 两份,扩展副本头注自述「mirrored
verbatim」;`closest("[data-word]")` 点击委托三份(两宿 reader 各一至两处)。
全仓最贵的并发知识——属主令牌、逐实体在途键控(savingKeys Set)、陈旧裁决
弃写——以两份拷贝存活,每次演化双倍测试维护。

## 方案形状(评审已锚,grilling 未锁)

共享弹窗内核,interface 约
`WordLookupPopup({ click, gateway: { lookup(word), setStatus(key, status) },
onClose, onStatusApplied })`;**两个 adapter 已在**——web
`apps/web/src/wordLookup.ts`(fetch,查词即落态)与扩展
`vocabulary-store.ts`(store.lookup/setStatus)——缝是真的。家:reading-model
第二 React 入口或新小包(待决策)。

## 待 grilling 锁定的决策(实施前置,评审已点名)

1. **React 子入口边界**:reading-model 现零 React 依赖、服务端运行时导入
   它——独立 React 子入口且根入口不重导出,还是新小包?peer dep 下纯服务端
   消费者可不装 React?
2. **ipaSource 披露**:扩展查找结果带词元回退来源披露
   (offline-dictionary.ts 的 ipaSource 字段,ADR-0006 明文要求)——必须进
   共享结果契约,照 web 实现抄模板会丢它。
3. **gateway 契约四问**:未收录 vs 失败如何区分;首查自动 Learning 迁移归
   adapter 还是内核;onStatusApplied 回边与属主令牌陈旧裁决的时序;gateway
   身份变更是否重启读取。
4. **竞态测试迁移**:在途键控 / A→B→A 再入不复活 / 同词形共享在途态三组
   主张,两宿各持一份镜像套件——内核化后写一次、双 adapter 各跑一遍。

## 边界存档(勿默默并入本票)

Codex 独立评审两条漏判,各自单列评估:①library-store 的 memory/chrome 双
实现行为重复(进度保留/更新时间/排序),共享的只是写队列;②两宿逐词 JSX
渲染(词 span/音标 span/可达性/底色)重复度超本票委托范围,与
wordStatuses 状态配对(评审候选 3)相连。

## 历史 论据更正

评审初稿曾以「5772005(10-27)在途键控修复只落 web」为分叉实证——不成立:
扩展弹窗 b38b78b(10-28)首版即含 savingKeys,分叉从未发生。本票依据 =
现存 196/247 行重复 + 竞态套件双份维护,足够。
