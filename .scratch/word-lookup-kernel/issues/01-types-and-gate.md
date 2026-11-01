# 01 · 类型与门:统一形状上收,react 立门

Status: done

## Scope

按 spec.md 决策 3 + 决策 1 的检查半。零行为、两宿零改动:

1. reading-model 根入口纯类型:`WordLookupResult = WordLookup & { status:
   WordStatus } & { ipaSource?: IpaSource | null }`;`WordStatus`、`IpaSource`
   定义上收至此。
2. server `wire.ts` 的 `WordStatus` 改 type-only re-export(保持 type-only
   性质,零 runtime 依赖变化);web `wordLookup.ts` 的 WordLookupResponse 改
   引统一形状;扩展 `LookupWithState` 改引,`VocabState` 成 `WordStatus` 别名。
3. 扩展 `offline-dictionary.ts` 的 IpaSource 改引 reading-model(联合形状
   原样上收,披露语义注释随行)。
4. 新增 `check:react-locality`(根 package.json scripts,循
   check:storage-locality 族):reading-model 根入口文件与其非 react 源禁
   import react、禁 re-export `./react` 子路径符号。脚本就位即入提交链。
5. react 挂 reading-model peerDependencies。

## Gate

`npm run typecheck && npm test && npm run lint` 全绿;两宿测试断言零改写;
`check:contract-types` 过(wire type-only 不破);新检查脚本绿(此票无 react
内容,门先立后用)。

## Comments

Done。01 实现 commit a31e639、02 实现见本票配套 refactor commit
(双轴评审基线 e760fe5,一次覆盖两票)。Codex 沙箱实现 threadId 01a1966f。
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
