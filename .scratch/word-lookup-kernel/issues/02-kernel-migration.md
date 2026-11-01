# 02 · 内核迁移:组件入包,两宿薄壳,竞态工厂

Status: done
Blocked by: 01

## Scope

按 spec.md 决策 1/2/4 + 四条契约:

1. reading-model react 子入口(`src/react/`,构建 jsx 就绪,exports
   `./react`):`WordLookupPopup`(以 web 版为底合入扩展的 ipaSource 披露语
   义;props `{ click: { word, point }, gateway, onClose, onStatusApplied }`)、
   `useOwner`(实现唯一份)、`wordFromEvent` 委托助手。根入口不重导出。
2. reading-model testing 子入口(`src/testing/`,循 import-core/src/testing
   先例):竞态套件工厂承载三组主张(在途键控 / A→B→A 不复活 / 同词形共享
   在途),API 取两宿现有测试体的最小公共面,主张 1:1。
3. 两宿薄壳:web/ext 各留 gateway adapter(模块级常量,web 为
   fetchWordLookup/putWordStatus 包装,ext 为 store)+ 渲染调用;宿主删
   popup/useOwner/委托三份实现;web useOwner 测试改引包实现,断言零动。
4. 契约 JSDoc 单源(四条:查词即落态 / 404=null 失败 throw / onStatusApplied
   先于 stale / gateway 稳定性)。
5. 类名统一:web `lookup-speak`/`lookup-close` → `lookup-head-button`(+
   hover),`apps/web/src/style.css` 对应选择器更名;accessible-name 断言不
   动,红即记档退回。

## Gate

`npm run typecheck && npm test && npm run lint` 全绿;**两宿既有弹窗测试断言
零改写**(web wordLookup 套件、extension readerPage 弹片段);竞态工厂双宿各
绿;`check:react-locality` 仍绿(根入口无 react 引用);dist 不碰。

## Comments

Done。01 实现 commit a31e639、02 实现见本票配套 refactor commit
(双轴评审基线 e760fe5,一次覆盖两票)。Codex 沙箱实现 threadId 01a19675。
红绿:01 零行为纯上收;02 验收零改写逐行核实(wordLookup/readerPage
各纯追加工厂 describe、useOwner.test 仅 import 换家,断言零动),全链
EXIT=0、526 tests(520+竞态工厂双宿 6 枚)。双轴判定:Spec clean(零缺
失;类名统一外观不变已证:旧 web 类名本无 CSS 规则;合并零丢行为——删除
文件逐一 diff)+ Standards 零硬违规。修 1 笔:offline-dictionary 的
IpaSource 再导出零消费者,删(Middle Man)。记档 3 笔:别名三连
(WordLookupResponse/LookupWithState = WordLookupResult)为迁移脚手架,
单一名字留后续;testing 子入口 import vitest 绑定测试框架,循
import-core/src/testing 先例;ReadingView 的 ClickPoint/WordClick 双入口
shim 属兼容垫,保留。
