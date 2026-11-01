# 01 · op 协议收编:hook 内铸 op,页半退役

Status: done

## Scope

按 spec.md 决策全量实现。要点清单:

1. `apps/web/src/progressSession.ts`:
   - options 删 `target`,留 `{bookId, chapterNumber, ready}`;
   - 内部 `useState<(BookmarkTarget & {op}) | null>` armedTarget +
     jumpOpRef;
   - `armJumpTarget(target)` = opRef 递增 + setArmedTarget({...target, op});
     JSDoc 单源两契约(op 按意图单调不复位 / 与导航同事件武装,React 批
     渲染)——删除 ReadingPage.tsx:119-124 与 progressSession.ts:26-36
     的旧契约散文;
   - render-adjust 守卫扩一行:bookId 变 → setArmedTarget(null)(与
     consumedOpRef 水位重置同一 if 块);
   - 恢复 effect 消费 armedTarget;水位判定 / lastRestoreRef /
     scheduleSave 落位保存 / 缺块降级逐字节不动;
   - `return { saveFailed, armJumpTarget }`。
2. `apps/web/src/ReadingPage.tsx`:删 jumpTarget state、jumpOpRef、换书
   清空 effect、armJumpTarget 本体(:119-140 一带);取用改为
   `const { saveFailed, armJumpTarget } = useProgressSession({ bookId,
   chapterNumber, ready })`;jumpAndClosePanel 改调 hook 版;各 handler 的
   事件结构不动(同章 button onClick / 跨章 Link onClick+to,同事件武装
   保持)。
3. 块选择器单源:progressSession.ts 导出常量或助手(形状按最小 diff 定),
   readingProgress.ts:53-56 与 web 测试的字面改引;harness 不动。
4. 测试:`progressSession.test.tsx` render 助手删 target 入参;:503-754
   九枚按 armJumpTarget 改写(主张 1:1);新增两枚(连调两次同 target
   重滚 / 换书清空 it.each);`reading.test.tsx` 与 :86-502 零改写。
5. 先红后绿:先把 target 面测试改写到新接口(typecheck 红),再实现转绿。

## Gate

`npm run typecheck && npm test && npm run lint` 全绿;:86-502 与
reading.test.tsx 断言零改动通过(行为保真证明);评审基线 = 本票首个实现
commit 之前的 HEAD。

## Comments

收官(2026-11-01)。基线 5a0aa32,实现 commit e7d6a5e;双轴评审(两并行
子代理,Standards + Spec 分轴)后修 3 笔复跑门禁仍绿。

- 红绿:typecheck 先红(armJumpTarget 新接口无实现,Codex 沙箱实测
  failed-before-implementation);绿 = `npm run typecheck && npm test &&
  npm run lint` 全链 EXIT=0(520 tests / 46 files),评审修复后复跑仍 EXIT=0。
- 零改写核实:reading.test.tsx 7 行 = 1 import + 3 处选择器字面换
  readingBlockSelector;progressSession.test.tsx 零区内 3 hunk(旧
  :103/:123/:464)同为字面替换;断言零动。
- 票面漂移:target 面实存 9 枚非票写 12 枚,9 枚全迁移 1:1(spec 已同步
  修正);新增实为 2 枚(连调两次重滚 + 换书清空 it.each 双 ready 相位,
  后者评审裁收:决策 2 的 render-adjust 否则零 hook 级覆盖)。
- Spec 轴:五决策零缺失;三处超票面动作裁收(Object.is 防 NaN 路由
  render 期 setState 每渲染重入——守卫侧注释已带 why;it.each;迁移测试
  断言强化,主张无损)。
- Standards 轴:零硬违规(render-adjust 循 CODING_STANDARDS「State keyed
  by a route or prop follows the key」endorsed 形状;A→B→A 由 op 不复位 +
  水位换书重置保证)。judgement calls 两修一记档:修 = 删 progressSession
  对 readingBlocks 的 re-export(Middle Man,单一 import 家)、三处 inline
  querySelector 收进既有 blockEl 助手、armJumpTarget 的 /** */ 归 // 文件
  习法;记档 = reading.test.tsx 三处 inline 不抽本地 helper(零改写区不再
  进场,留待下次该文件实质改动);Object.is 依「pin unreachable behavior」
  规则记档不扩 pin(断言包络 !== 与 Object.is 下可观测相同)。
