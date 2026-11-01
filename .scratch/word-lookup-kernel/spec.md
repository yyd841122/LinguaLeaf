# word-lookup-kernel:点词查详情弹窗内核两宿收编

来源:architecture-review-20261101 候选 1(Strong,Claude 勘探 + Codex 独立评审
双判;报告 gitignore,问题与依据原载 stub 票,已折入本 spec)。grilling 四决策
全锁(2026-11-01,维护者「全按推荐」);gateway 四问中三个半由代码定案,不再
决策。

## 问题

web `WordLookupPopup.tsx`(247 行)与扩展版(254 行)196/247 行逐字节相同;
`useOwner` 双份(扩展副本自述「mirrored verbatim」);`closest("[data-word]")`
点击委托三份。全仓最贵的并发知识(属主令牌、逐实体在途键控、陈旧裁决弃写)
以两份拷贝存活。依据 = 现存重复 + 竞态套件双份维护(「5772005 分叉」论据已
撤:b38b78b 首版即带 savingKeys)。

## 已由代码定案(契约,不再决策)

1. **查词即落态**:首查自动 New→Learning 归 adapter——web 服务端 lookup 路由
   `statusAfterLookup→learnWordIfAbsent`,扩展 store.lookup 内 enroll;内核永不
   入学。
2. **未收录 vs 失败**:`gateway.lookup(word) → Promise<Entry | null>`,null =
   未收录(404),rejection = 失败;404 不得冒充服务端打嗝。
3. **回边时序**:`onStatusApplied` 先于票裁决(popup-status-backedge 决策 3:
   已存事实属于那个词);弹窗自身状态补丁受 stale 守卫。
4. **gateway 稳定性**:读取 effect 只键 `[word]`;契约写明 gateway 须弹窗生命
   周期内稳定;web 出模块级 gateway 常量(扩展 store 本就 app 级)。

## 决策(grilling 四锁)

1. **家 = reading-model React 子入口**:第二入口,根入口不重导出;react 挂
   peerDep;新增 locality 检查(循 check:storage-locality 先例:根入口文件禁
   import react / 禁 re-export 子入口符号)。
2. **测试 = reading-model/testing 子入口**(循 import-core/src/testing 先例):
   竞态套件工厂住那,三组竞态主张(在途键控禁用 / A→B→A 再入不复活 / 同词形
   共享在途)一次书写,双宿各传 adapter + 假件各跑一遍;testing-library/jsdom
   留宿主 devDep,包不加重。
3. **类型 = 根入口(纯类型)**:`WordLookupResult = WordLookup & { status:
   WordStatus } & { ipaSource?: IpaSource | null }`;`WordStatus`/`IpaSource`
   定义上收(server wire 保持 type-only,改引 reading-model);扩展 VocabState
   成别名,行为零变;web `WordLookupResponse`、扩展 `LookupWithState` 改引统一
   形状。
4. **范围与验收**:useOwner + data-word 委托助手随内核入包(宿主删副本,测试
   改引实现,断言零动);类名漂移顺路统一(web `lookup-speak/close` 归共享
   `lookup-head-button`,accessible-name 断言不动,红即记档退回);**验收 =
   两宿既有弹窗测试零改写全绿**(web 桩全局 fetch 走 adapter,扩展走
   memoryBackend,gateway 注入不碰桩层);边界不并入:library-store、两宿逐词
   JSX 渲染、wire 状态数组(候选 3)。

## 票

- **01 类型与门**:决策 3 + 决策 1 的 locality 检查先行——零行为、两宿零改动。
- **02 内核迁移**:决策 1/2/4 + 上述契约——组件/useOwner/委托入包,两宿薄
  adapter 化,竞态工厂接线,类名统一。Blocked by 01。

## Gate(两票合看)

`npm run typecheck && npm test && npm run lint` 全绿;零改写承诺:两宿既有弹
窗测试断言零动;评审基线 = 01 首个实现 commit 之前的 HEAD;双轴评审一次覆盖
两票。
