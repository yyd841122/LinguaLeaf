# 03: ECDICT 音标行 + 查词 API

**What to build:** 导入管线补上音标：分词、词形还原后查 ECDICT 美式音标，句子块的音标行填上 IPA；词库里没有的词在音标行留空跳过。同时提供 GET /api/lookup/:word（还原原型后返回音标、词性、中文释义），为点词弹窗备好数据源。ECDICT 官方数据导入服务端本地库。

**Blocked by:** 02 Markdown 导入到句子块阅读（第一条曳光弹）

**Status:** ready-for-human

- [x] 有可重复执行的 ECDICT 数据导入步骤，词库查询走服务端本地
- [x] 导入后的书音标行显示每词美式 IPA
- [x] 变形词（复数、时态等）还原原型后查询不落空
- [x] 查不到的词：该词音标留空，整句其余部分正常
- [x] GET /api/lookup/:word 返回音标 + 词性 + 中文释义
- [x] API 缝测试覆盖常见词、变形词、未知词三类

## Comments

- 2026-10-17 (Claude): 实现。**数据源决策**：ECDICT 官方数据实证只有单一 `phonetic` 字段（README"以英语英标为主"，无美式字段），经用户拍板改为 ipa-dict en_US（125k 词条，MIT）为主源 + ECDICT phonetic 兜底。词库为服务端本地单个 SQLite（`.data/ecdict.sqlite`，`ECDICT_PATH` 可改），三表：`dict_words`（ECDICT 裁剪至 word/phonetic/translation）、`dict_ipa_us`（ipa-dict 去斜线首变体）、`dict_inflections`（exchange 字段双向导出的 form→lemma 索引）。两个幂等导入脚本：`npm run dict:import-ecdict -- stardict.db`（3.4M 行→130 万词条+16.7 万还原对，7.2s）、`npm run dict:import-ipa-dict -- en_US.txt`（12.5 万条，0.5s），步骤见 README。
- 2026-10-17 (Claude): **解析链**：IPA 行与查词共用 `resolveIpa`（ipa_us 精确→还原后 ipa_us→ECDICT phonetic 精确→还原后 ECDICT）；变形词复数保留自己的美式读音（books /ˈbʊks/）。ECDICT 给变形词填的纯指针词条（"be的过去式"这类，无词性无实义）穿透到原型词条取释义；有实体释义的词条不动（gone/saw）。词性取 translation 行首标记（ECDICT `pos` 列是 `n:96` 频次码不适合展示）。**空槽契约**：未知词留空槽（句中双空格、HTML 折叠为视觉间隙；首尾 trim），数字/纯标点不占槽；code/raw 块不生成音标（NULL）。`GET /api/lookup/:word` 返回 `{word, lemma, ipa, pos, translation}`，查不到 404。
- 2026-10-17 (Claude): 门禁全绿（退出码已验）：typecheck、35/35 测试、lint、build；生产 + dev E2E（curl --noproxy）真词库导样例书：全句美式 IPA（Mr. Gupta woke early. → /ˈmɪstɝ ˈɡʊptə ˈwoʊk ˈɝɫi/）、`LinguaLeaf's` 留空槽其余正常、wrote→write / was→be 还原、unknown 404。修复过程发现两处自伤并纠正：门禁退出码曾被管道 tail 吞掉（test/frontend.test.ts 旧签名漏改）；`defaultDictionaryPath` 的源码相对路径在编译版跑偏（改由 main.ts 按 runtimeRoot 解析，与 DATABASE_PATH 同模式）。
