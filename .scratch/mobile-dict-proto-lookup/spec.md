# mobile 词典外部词键原型污染:constructor/toString 等真实词查错

**Status:** done

来自 mobile-app 02 独立终审发现 3+7(2026-11-16,threadId
01a1e1db-a5d2-75f0-9f2f-1c7b4accd86b):

1. `offline-dictionary.ts:83`:`this.data.inflections[word]` 裸索引——
   真实单词 `constructor`(及 toString/valueOf/hasOwnProperty 等全部
   Object 原型属性名)无自有键时会读到原型函数,lemma 变函数、生词
   导出键变 `function Object() { [native code] }`。修法:外部字符串键
   用 `Object.hasOwn` 或 Map(CODING_STANDARDS「Lookup tables keyed by
   external strings probe with hasOwn」的直接案例)。
2. 证据缺口(发现 7):`offlineDictionary.test.ts` fixture 注释声称覆盖
   薄指针条目,实际无薄 `runs` 条目;把查词优先级翻成「词形条目抢占
   词元完整释义」不会红。补薄 runs + 完整 run 并断言完整释义胜出。

## Comments

- 2026-11-16 立票。站点已现场核验(裸索引 + 原型链可达)。

- 2026-11-16 Lane A 实现(Codex 审核排队,与 A-1~A-3 同批等配额):
  commit 4c9c57e(基线 b8cdebd)。三表 Map 化(构造期 Object.entries 只收
  自有键,取 CODING_STANDARDS 该条目的 Map 选项);fixture 补薄 runs,
  既有 runs→run 测试即优先级钉。新测试 2 片,双变异心证:裸索引还原后
  仅原型测试红;lookup 优先级翻转(form-first)后仅 runs 测试红。
  全量 verify 108 文件 1208 测试绿。

- 2026-11-16 Codex 审核(threadId 01a1e2c3-fb2a-7e42-a810-a5e22a16cece,
  基线 b8cdebd→4c9c57e):实现逐项 PASS(10 处读点全换/顺序保留/容错
  保留);**NO-GO 一项 P2 证据缺口**:原型测试选词经 normalization 后
  多数折离原型——entries 裸索引单点回退、lookup 内 inflections 单点
  回退均仍绿。修于 c7e252a:补两条不变量断言(无自有条目时
  lookup("constructor")===null——constructor 是唯一折叠后仍命中原型的
  词,钉 entries 表;baked 自有条目时 lookup("constructor").lemma===null,
  钉 lookup 内 inflections 读点),两变异实证咬合。

- 2026-11-16 收官翻 done:Codex 实现全 PASS + P2 证据缺口补强在 c7e252a,entries/inflections 单点变异咬合,verify EXIT=0。真机人验项各自挂账等机检。
