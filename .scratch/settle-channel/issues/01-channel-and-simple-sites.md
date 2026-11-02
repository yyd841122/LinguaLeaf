# settle-channel 01:裁决通道内核 + settleRaceSuite + 简单三站

Status: ready-for-agent

来源:`../spec.md`(决策全录,维护者 2026-11-02 拍板)+ Codex 计划评审
(threadId `01a19c40-a717-7661-85f2-017407816e27`)。基线:HEAD before this
ticket's first implementation commit(立票时点 d4bb37d)。

## 范围(01)

- 新模块 `packages/reading-model/src/react/useSettle.ts`(裁决通道)+ react
  子入口出口;testing 子入口新增 `settleRaceSuite` 工厂。
- 迁移三站:#1 bookmarksSession.settleOp、#2 chapterTranslation.start
  (startFailed 通道化;pollFailed 是 #3 outage 的别名,随 #3 走)、
  #3 taskFollower.tick(含 Q7 cancelled 退役)。
- **不在本票**:#4 flushSave(外携票据真用例)、#5 applyStatus(onLanded
  真用例)、#6/#7 ext 两站、CODING_STANDARDS 回指——全部 02 票。ext 本票零涉。

## 接口定稿(已拍,实现不得即兴)

```ts
// packages/reading-model/src/react/useSettle.ts(循仓内 .js 后缀 type-only 习法)
import type { Owner, OwnerTicket } from "./useOwner.js";

export type SettleOutcome<T> =
  | { ok: true; value: T; fresh: boolean }
  | { ok: false; fresh: boolean };

export type SettleHooks<T> = {
  /** 不凭票的落页应用:成功即调恰一次,陈旧也调;缺省 no-op。 */
  onLanded?: (value: T) => void;
  /** 凭票的本地应用:仅新鲜成功,清旗后调恰一次;缺省 no-op。 */
  onFresh?: (value: T) => void;
  /** 外携票据;省略 = owner.mark();显式 null = 照发 op、旗与回调全不写 */
  /**(flushSave 契约预留,02 票启用;01 内核测试钉语义)。 */
  ticket?: OwnerTicket | null;
};

export type SettleChannel = {
  /** 唯一失败旗;裁决写入全通道只有两处:新鲜失败→true,新鲜成功→false。 */
  readonly failed: boolean;
  /** 意图侧清旗;引用稳定。 */
  clear: () => void;
  /** 引用稳定;照发 op,永不因票据状态拒发。 */
  run: <T>(op: Promise<T>, hooks?: SettleHooks<T>) => Promise<SettleOutcome<T>>;
};

export function useSettle(owner: Owner): SettleChannel;
```

语义(编号定死):

1. **发送不受裁决**:run 照发 op——裁决只管落回,不管发送(flushSave
   「票据空也照发保存」契约的前提,progressSession.test:322 现行钉)。
2. **禁隐式 invalidate**:run 不作废任何先前票据;作废是调用方对 owner 的
   显式动作,逐站点见下表。
3. **成功序列定死**:`onLanded(value)` 恰一次 → 验票 → 新鲜才:清旗 +
   `onFresh(value)` 恰一次。返回 `{ ok: true, value, fresh }`。
4. **失败序列**:验票 → 新鲜才:置旗。返回 `{ ok: false, fresh }`。
   **op 的拒绝永不穿透**(吞进裁决)——01 三站现状皆吞,零漂移;
   02 票 #6 若需传播,凭 outcome `ok:false` 自行 rethrow。
5. **hooks 缺省各自 no-op,互不回退**(禁「缺省同钩」双重应用)。
6. **票据三态**:省略 → `owner.mark()`;传票 → 凭它裁决;显式 null →
   旗与回调全不写(照发照裁,只不落)。
7. **异常边界**:hook 同步抛出 = 调用方自身缺陷,run 的返回 Promise 以该
   异常 reject,序列在该点中止;已发生的裁决写入不回滚(landed 抛 → 验票
   未到,旗不动;fresh 抛 → 旗已清)。
8. **引用稳定**:clear/run useCallback([owner]);Owner 系 useMemo 稳定对象
   (useOwner.ts:29-31),effect 依赖 channel 函数不重挂。
9. **arm 清旗不是通道的事**:意图侧显式 `clear()`(Q6=B),清单见下。

## 三站行为矩阵(冻结)

| 站 | 旗 | 作废点(显式) | run 用法 | 行为等价锚(既有用例) |
|---|---|---|---|---|
| #1 bookmarksSession | channel.failed(列表/建/删共一枚) | 列表 effect 头 `owner.invalidate()`(现状既有,保留) | 列表 `run(fetch,{onFresh:setBookmarks})`;建/删 `run(op,{onFresh:merge})`(票据省略=逐 op mark,与现状逐 op mark 等价) | bookmarksSession.test 11 its |
| #2 chapterTranslation | startFailed → channel.failed(owner=useOwner(bookId,chapterNumber) 身份键,路由陈旧自动判) | 无显式 invalidate(现状 start() 只 mark 不作废;双击 409→202 中间态保持) | trigger `run(translate,{onFresh:onTranslationState})`;**tick 成功恢复 = onTick 内显式 `channel.clear()`**(现 :97-98 的 setStartFailed(false) 迁形) | chapterTranslation.test 7 its |
| #3 taskFollower | outage → channel.failed(私有 useOwner():34) | teardown `owner.invalidate()`(**cancelled 退役**);公开 `invalidate` 照旧直通 owner | 每 tick `run(fetchTickRef.current(),{onFresh:(d)=>onTickRef.current(d)})`(票据省略=逐 tick mark) | taskFollower.test 6 its + 新增 3 枚(下) |

清旗全清单(01 范围,全部显式 `channel.clear()`):
bookmarksSession 列表 effect 头(现 :58-59 内联 setFailed(false))、
chapterTranslation start() 头(现 :67)、chapterTranslation 路由复位 effect
(现 :54-56)、chapterTranslation onTick 内恢复(现 :97-98)、taskFollower
follow 开始(现 :52)。#1 建/删 op、#2 trigger、#3 逐 tick 均**不**清旗。

## 测试(D4 定稿:套件与内核测试为增量,站点力争零改写)

1. **内核契约测试** `apps/web/test/useSettle.test.tsx`(循 useOwner.test 住
   宿侧先例):语义 1-9 全钉——含 landed 先于验票、null 票全不写、hook 抛出
   中止点、outcome 形状、clear/run 引用稳定(Object.is)。
2. **settleRaceSuite**(testing 子入口,循 wordLookupRaceSuite 的
   RaceSuite/Gateway 参数化形):通用竞态场景函数化(陈旧成功/陈旧失败/
   新鲜成功/新鲜失败/显式 null 票),宿传真实站点 mount;react 零 import
   (门禁安全,现 testing/index.ts 仅 vitest + type-only)。01 三站测试文件
   各传真 mount 跑一遍;landed/null 场景 01 仅内核级(02 的 popup/flushSave
   启用站点级)。
3. **站点既有用例零改写为预期**:公开面(useBookmarksSession/
   useChapterTranslation/useTaskFollower)与 mock 边界(../src/* fetch 助手)
   不变,books 11 + chapter 17 + task 6(计 34 枚;vitest 计 it.each 展开,
   grep `it\(` 只见源行——计数以跑套件为准)应 verbatim 绿。出现改写/删除
   **逐条列名+理由**于本票 Comments,评审轴勾稽(禁丢旧行为证据)。
4. **新增(3 枚,Q7)**:teardown 后旧 tick 失败侧不置 outage;teardown 后
   重挂恢复跟随;StrictMode 双挂载不产生双 tick 落回。
5. useOwner.test 11 tests 不动(属主令牌契约,不吞并)。

## 验收门

- 沙箱内:typecheck + lint + 非 HTTP 测试全绿(books/chapter/task 三文件
  verbatim 绿是行为等价的直接证据)。
- **caller 检查点(人工,勿跳)**:全链 `npm run verify`(含 contract/api
  HTTP-seam、react-locality、构建)EXIT=0,收尾在票面记 EXIT 与测试总数;
  双轴评审(Spec/Standards);收官 docs commit 翻 Status: done。
- react-locality 门禁绿(新符号只住 react/ 与 testing/,根入口零沾)。

## Comments

- (2026-11-02 立票即纠)计数漂移记档:初稿写「books 11 + chapter 7 +
  task 6 its / useOwner 7 its」,grep `^\s*it\(` 漏掉 `it.each` 展开数;
  立票 commit(52e531d)的 pre-commit 全链跑出真相——chapterTranslation
  **17**、progressSession **33**(02 票面)、useOwner **11**,bookmarks 11 与
  taskFollower 6 恰好无 each。已按 vitest 实数修正本票与 spec;教训入档:
  票面测试计数以跑套件的输出为准,grep 源行只当下界。
