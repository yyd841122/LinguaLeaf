# 备份完整性缺陷簇:校验零写入失守 + 译文键未校验 + 导出书名键原型污染

**Status:** needs-triage

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
