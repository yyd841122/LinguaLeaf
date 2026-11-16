# mobile 词典外部词键原型污染:constructor/toString 等真实词查错

**Status:** needs-triage

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
