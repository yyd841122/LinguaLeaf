# 备份完整性缺陷簇:校验零写入失守 + 译文键未校验 + 导出书名键原型污染

**Status:** claimed

来自 mobile-app 05 独立终审发现 2+3+4(2026-11-16,threadId
01a1e1e9-f7c3-7550-927e-9e06deee6655;编排侧现场核验站点):

1. `backup-format.ts:101`:笔记只验非空,不验长度上限;超长笔记通过校验
   后在 apply 期失败——此时生词/进度已写入,**违反「损坏文件零写入」**。
   修法:确定性写入约束(长度等)前置到校验期。
2. `backup-format.ts:137`:译文段只校验值是对象,章节/块的键完全不校验
   → 非整数、负数、数字别名键被接受,apply 期写出 NaN 章节。修法:两层
   键都按规范非负整数校验。
3. `backup-router.ts:105`(server):`out[row.title] ??=` 以外部书名裸索引
   普通对象——书名恰为 `constructor` 时命中继承属性(真值),`??=` 不
   赋值,该书译文**静默漏出备份**。与 mobile 词典同族
   (`.scratch/mobile-dict-proto-lookup/`);修法:Map/无原型对象/hasOwn,
   补特殊书名 fixture。

## Comments

- 2026-11-16 立票。
- 2026-11-16 Lane A 实现(Codex 审核待配额):三缺陷已修,commit 8a463f0
  (基线 59121ba)。新增测试 mobile 12 + server 1,变异心证实证:还原 src
  后 12 红全数咬合(5 章节键 + 3 块键 + 空书名 + 零写入 + 长度变体 +
  server constructor);全量 `npm run verify` 绿。Codex 审核 prompt 已发,
  撞用量限额(12:33 PM 重置,threadId 01a1e227 无产出),重置后补跑审核,
  过门后 caller 补跑 verify 再翻 done。
- 顺带核过 mobile 侧 stores 裸索引:bookmark-store.ts:207 / translation-store.ts:99
  同款 `??=`,但键恒为 `doc:`/`fp:` 前缀(非原型成员名),内存 twin 走 Map,
  原型名不可达,无同族病。两处常量(MAX_NOTE_TEXT_LENGTH / NOTE_TEXT_LIMIT
  均 10_000)分属两端,语义今天一致;若 server 端将来单独上调,PC 导出会撞
  手机校验门——暂不立案,留观。
  〔更正 2026-11-16 Codex 评审:PDF 前缀实为 `pdf:sha256-v1:`(pdf-fingerprint.ts),
  非 `fp:`;前缀保证来自调用路径,store 接口与持久化读取本身不强制——留观结论不变。〕

- 2026-11-16 Codex 审核(threadId 01a1e2b6-08e2-7961-b81b-121242494a34,
  基线 59121ba→8a463f0):三生产修复全 PASS(逐条变异心证含 >= 边界);
  **NO-GO 一处 P2**:零写入测试预置与 payload 同值(hello:known)+未查书签,
  评审探针实证「校验前偷写 vocab/bookmarks 仍全绿」,违反 No-change claims。
  已修:预置改 hello:learning + 书签 {7,3} 异位锚,断言偷写后必红;探针同款
  变异复核咬合(1 红)。非阻断余量:块层 1.5/1e3 用例缺(备注)。caller 补跑
  verify 后翻 done。
