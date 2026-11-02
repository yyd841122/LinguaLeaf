# settle-channel:落回裁决通道——七份手抄裁决收进一个 deep module

来源:architecture-review-20261102 候选 1(Strong;报告 gitignore
`.scratch/architecture-review-20261102-201147.html`,本 spec 是候选的入档载体)。
grilling 三轮 + Codex 计划评审(gpt-6.1-sol/high,threadId
`01a19c40-a717-7661-85f2-017407816e27`,裁决 NEEDS REVISION,四处高发现全部
吸收),全部决策维护者已拍板(2026-11-02)。评审稿 `plan.md` 留档(含三笔
漂移修正记档)。

## 问题

「陈旧异步响应不得写状态」不变量由属主令牌(GLOSSARY)承载,但令牌只共享
「陈旧与否」的裁决;整条**落回裁决**(GLOSSARY 新词条,本票立)——陈旧整包
丢弃 / 新鲜失败起旗 / 新鲜成功清旗并应用——在 web + reading-model 5 处手抄、
扩展宿 2 处以非令牌土法实现,共 7 处。本周期生产裁决修复(b99b8a3
invalidate-at-arm、db63724 saveFailed 属主化)改的正是这条散线:no
locality——bug 不在任何单个模块内部,在「模块如何被调用」。

七站现场(2026-11-02 逐一核实,评审稿 plan.md §1 有全表):
#1 bookmarksSession.settleOp、#2 chapterTranslation.start(自有旗仅
startFailed 一枚;pollFailed 系 taskFollower outage 的解构别名,非独立站点)、
#3 taskFollower.tick(私有 useOwner:34,cancelled 布尔旗)、#4
progressSession.flushSave(票据外携)、#5 WordLookupPopup.applyStatus(先落页
后验陈旧 + savingKeys)、#6 ext ReaderPage.reopenDocument(reopenSeq 计数)、
#7 ext ReaderPage 词状态 bulk read(cancelled + merge-wins)。排除:ext
ReaderPage.tsx:415 restoreRef(consume-once,非裁决)。

## 决策(全部已拍,2026-11-02)

1. **D1 范围**:七站一次收齐;排除项不动。
2. **D2 形状**:react hook「裁决通道」住 packages/reading-model/src/react/
   (ext 已依赖该子入口,零新依赖);旗归通道持有;reading-model 根入口不放
   (check:react-locality 门禁)。
3. **D3 钩子**:「先落页后验陈旧」升一等钩子 `onLanded`(不凭票)/
   `onFresh`(凭票);两者缺省各自 no-op,禁「缺省同钩」(Codex 高发现 4)。
4. **D4 测试**:内核契约测试 + testing 子入口 `settleRaceSuite` 工厂(循
   wordLookupRaceSuite 先例,宿传真站点 mount);**套件与内核测试为增量,
   站点既有用例力争零改写**(公开面与 mock 边界不变即可 verbatim 绿);
   出现改写须逐条列名+理由,评审轴勾稽——此系原「改写是目的本身」表述经
   Codex F10(实现与测试同改丢证据为 Top3 风险)评审后的细化,R3 已拍。
   属主令牌契约测试(useOwner.test 11 tests)不吞并。
5. **Q6 清旗语义(B)**:通道只保证两条凭票裁决写入(新鲜失败→起旗、新鲜
   成功→清旗);意图侧清旗 = 显式 `channel.clear()`,清旗全清单进各票;
   run 从不在开始自动清旗(逐 tick 清会让 outage 闪烁、建删 op 多眨眼)。
6. **Q7**:taskFollower `cancelled` 布尔旗退役 → teardown invalidate 私有
   令牌;对外 surface {outage, invalidate} 不变;补停止后旧 tick 失败侧、
   重挂、StrictMode 用例。
7. **Q8/Q10 接口**:`useSettle(owner)` 显式属主入参(useOwner 的 Owner 返回
   useMemo 稳定对象,effect 可安全依赖);`run(op, hooks)` 票据三态(省略=
   mark / 传票=凭票 / **显式 null=照发 op、旗与回调全不写**);run **禁止
   隐式 invalidate**(双击 409→202 中间态语义保持),作废点逐站显式列表;
   run/clear 引用稳定;完整签名与异常边界表见 01 票。
8. **Q9/Q11 落地**:spec-as-ticket 拆两票(循 word-lookup-kernel 01/02 形):
   **01 = 通道内核 + settleRaceSuite + 简单三站(#1/#2/#3)**;
   **02 = 难站四枚(#4 外携票据 / #5 不凭票落页 / #6 点击作废 / #7 cleanup
   作废 + merge-wins)+ CODING_STANDARDS 裁决条目回指通道**;全量 verify 由
   caller 跑;实现走 Codex 沙箱 + 双轴评审。

## Comments
