# jump-target-protocol:跳转 op 协议收进 useProgressSession 单体

来源:architecture-review-20261101-111943.html 候选 2(Strong;Claude 勘探与 Codex
gpt-6.1-sol 独立评审双判 Strong)。grilling 五决策全锁(2026-11-01,维护者拍板
「全部按推荐执行」)。

## 问题

「什么让一次跳转重滚」的答案劈在两个 module:

- **页半**(`apps/web/src/ReadingPage.tsx:119-144`):jumpTarget state
  ((BookmarkTarget & {op}) | null)、jumpOpRef 按意图单调铸 op、同事件武装
  纪律注释、换书清空 effect。
- **hook 半**(`apps/web/src/progressSession.ts:24-36` target 入参契约散文、
  :81-93 consumedOpRef 水位 + 换书 render-adjust、:95-104 lastRestoreRef
  StrictMode 幂等)。

同一句契约「ops advance per intent and are never renumbered」在
ReadingPage.tsx:121 与 progressSession.ts:92 各写一遍;新跳转面必须重学纪律,
否则哑火。类型表达不了 op 纪律,散文存在的唯一原因就是类型不够。

## 决策(grilling 五锁,全按推荐)

1. **接口形状 = arm-only**:hook 返回 `{ saveFailed, armJumpTarget(target:
   BookmarkTarget): void }`,只武装不导航;op 从公开类型消失,hook 内铸。
   页面保留导航职责(同章 button / 跨章 Link + onClick)与「同事件武装」
   纪律,约束单源到 armJumpTarget 的 JSDoc。面板 button/Link 双形不动。
   jumpTo(arm+navigate 内化)不做——第三个跳转面出现时再评估(循偏好
   五件套同款 YAGNI 判法)。
2. **换书清空 = render-adjust 内化**:armed target 为 hook 私有 state,
   render 期 bookId 变即清(与 consumedBookIdRef 水位重置同一守卫,循
   progressSession.ts:85-90 自述 endorsed 形状;时序先于一切 effect,比现
   页面 effect 的声明序耦合更强)。target 形状不变({chapter, block});
   页面 effect 删除。
3. **useBookmarksSession 不并入**(Codex #21:勿捆绑两套行为验证);书签
   面板三动作协调留页面。
4. **块选择器单源收进本票**:选择器字面现两源(progressSession.ts:160
   blockElAt、readingProgress.ts:53-56)+ web 测试引用;导出单一常量或
   助手,两源与测试改引。ReadingView 的 data-position JSX 属性写侧是 DOM
   词汇非选择器,仅注释指向。harness 的 regex 双账本 pin 不动(harness
   必须免构建,常量帮不到它)。
5. **验收三层口径**(对口头 Q5 的精确化:「754 行零改写」不成立,因
   target 入参消失):
   - 页面级 `reading.test.tsx` 跳转三片:**零改写**全绿——真行为保真网;
   - hook 非 target 面(`progressSession.test.tsx:86-502`):**零改写**;
   - hook target 面(`:503-754`,九枚;原写十二,实数九——漂移记
     issue Comments):按 armJumpTarget 新接口改写,
     **语义主张 1:1 迁移,一个不许丢**(:574 consume-once、:618 op 推进
     连按合并、:643 缺块降级、:664 跨章 flush 先行、:705 StrictMode 逐字
     重滚、:731 换书 op 重编号);另新增两枚:连调 armJumpTarget 两次同
     target 断言重滚(op 内铸的直接钉)+ 换书清空 it.each 双 ready 相位
     (评审裁收——决策 2 的机制否则零 hook 级覆盖)。

## 不做(边界)

恢复优先级/防抖/flush 定序零改动;saveFailed 与四条失败通知通道不动;
lastRestoreRef/水位语义不动;jumpTo 不做;书签会话不动。

## Gate

`npm run typecheck && npm test && npm run lint` 全绿;零改写两层的存在即
行为保真证明;评审基线 = 本票首个实现 commit 之前的 HEAD(关系表述,
非 SHA)。
