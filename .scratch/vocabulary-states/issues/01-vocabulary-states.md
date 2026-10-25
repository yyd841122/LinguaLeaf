# 生词本四态:词元状态表 + 弹窗状态操作 + Known/Ignored 视觉弱化

Status: done
Type: task

按 `../spec.md` 落地,领域规则以 `docs/adr/0005-vocabulary-four-state-model.md` 为准。
动工前先跑一轮 grilling:状态表落点(book-store 内还是独立 module)、lookup 自动迁移的
写入口、弹窗操作的 API 形状——spec 只给了方向。

## Comments

### Implementation(2026-10-25,agent)

Status → done。`npm run verify` 退出码 0(329 tests);提交 68dd269(服务端)、09b155b(web)、评审修复一轮。

**落点**

- `schema.ts`:word_states(lemma 主键,CHECK 三态,updated_at);老库靠 `CREATE TABLE IF NOT EXISTS` 自动长表,无需迁移故事(schema.test 钉)。
- `vocab-store.ts`:word_states 全部 SQL + `STATE_READ_COLUMNS`;`learnWordIfAbsent`(读后插,缺席即 learning,无更新路径)、`setWordState`(幂等 upsert,任意态→任意态)、`clearWordState`、`loadWordStatuses`(整表 Map)、`tokenStatuses`(token→键→状态 join)。门禁 `check-sql-locality.mjs` 扩成「表→属主」map,word_states→vocab-store 钉死,`CODING_STANDARDS.md` 同步。
- `dictionary.ts`:`lemmaOf` 导出;新增 `vocabularyStateKey`(词状态键唯一规则:lemma ?? 折叠形)——lookup 写入与章节 join 共用这一处,两缝永不漂移。
- `lookup-router`:states store 构造时注入(app.ts 以 `statusAfterLookup → learnWordIfAbsent` 闭包组装),响应带 status;命中已存在(含 known/ignored)不动;404 不写。前端零逻辑。
- `vocab-router`:`PUT/DELETE /api/vocab/lemmas/:lemma`;非法 status 400,折叠为空的词元 404。服务端无迁移矩阵。
- `books-router`:`toChapterPayload` 给每个 sentence block 附 `wordStatuses`(tokenizeWords 序,null=New),GET 与触发 202 走同一构造,永不不一致。
- web:`SentenceBlock.wordStatuses` 必填(全部 stub 迁移);Known/Ignored 加 `word-settled` 只去 hover 底色,词色/音标/点击不动;弹窗三按钮(学习中/已掌握/已忽略,aria-pressed),PUT 词元幂等设态,失败提示可见、落定即恢复;保存进行中整行禁用,词切换丢弃陈旧判定。
- contract:lookup 全形含 status、章节块 wordStatuses 字面、PUT 与 DELETE 接缝(204 无体、幂等)。

**票内显式决定(spec 点名「不做静默省略」)**

- **导出文件 v1 不带生词本状态**:export 链路零改动(export-front.ts / annotated-book.ts 无任何 word_states 引用,已核)。理由:导出是快照,状态是活的用户数据;状态操作只在 LinguaLeaf 内有意义。本条即显式记录。
- **DELETE 服务端就位但 v1 无 UI 调用**:决策 4 要求 DELETE 形状存在;弹窗操作集按决策 4 只有三态,故 web 客户端暂无对应函数,contract 钉其接缝形状,留待「忘掉这个词」类 UI。

**评审(两轴并行)与修复**

- Standards 轴:①弹窗文案「忽略」改 GLOSSARY canonical「已忽略」;②DELETE 缺 contract pin——补 204 无体 + 幂等往返;③状态键规则两处——收敛为 `vocabularyStateKey` 单一属主;④弹窗连点竞态——saving 禁用整行 + 词切换丢弃陈旧判定(两个新测试钉住);⑤vocab 路由 400/404 暂为纯文案错误体——今日无客户端分支、未违「code+copy」字面,未来要分支先进 wire 码 union(记录,不动)。
- Spec 轴:唯一缺口是导出决定未落票(上文已补);弹窗失败提示与 aria 标记属票外低风险加分项,记录于此。
- 对齐确认:tokenizeWords 与 segmentOriginal 同走 WORD_PATTERN,前端按下标取状态;不匹配时安全退为 New(只丢弱化,不出错显),api/contract 测试钉字面。

**人机共检(spec 门禁,勿跳)**

- GLOSSARY.md 新增四词条(生词本/学习中/已掌握/已忽略)请人工过目;New 判定为「行的缺席」、UI 从不显示该词,故不成词条。

### Grilling 决策(2026-10-24,六项全数与维护者对齐锁定)

1. **状态跨书**:`word_states` 按 lemma 主键,无 book_id——「会一个词」在哪本书都会,状态是学习者资产(GR ADR-012 本义)。
2. **落点**:新建 `vocab-store.ts` 持有 word_states 全部 SQL + 唯一列清单常量(DDL 照惯例进 schema.ts),不折进 book-store——书数据与学习者数据不是一个领域,dict/(自己的库自己的 router)是先例。`check-sql-locality.mjs` 从单一表集合扩成「表 → 属主文件」map,`word_states → vocab-store.ts` 钉进门禁,「One table, one column list」对新表继续生效。
3. **自动迁移写入口**:`GET /api/lookup/:word` 命中且状态行不存在时,服务端同请求内插入 `learning`(缺席 = New,纯 insert,无更新路径);已存在(含 known/ignored)一律不动;404 未命中不写。规则单侧服务端,前端零逻辑;router 构造时注入 states store。
4. **操作 API**:`PUT /api/vocab/lemmas/:lemma` 幂等设态 `{status: learning | known | ignored}`,`DELETE` 同路径回 New(删行)。服务端不建迁移矩阵,合法迁移只由弹窗操作集表达:任何态可显式标 Known / 标 Ignored / 回到 Learning——与 ADR 0005「Known/Ignored 只能显式迁移」一致。
5. **弱化通道**:章节 GET 响应为每个 word token 附带状态(服务端复用 `tokenizeWords` + `lemmaOf` 做 join),前端拿到即渲染、不做词形还原。v1 不给 token 存 lemma 列(不镜像 ipa_slots);本地点查一章几千 token 应无感,真慢了另开票加缓存列。
6. **弱化视觉**:Known/Ignored 的词只去掉 hover 底色(收回查词 affordance),词色、音标渲染一律不动;更大的视觉动作等实际使用反馈再说。

新会话可直接 `/implement .scratch/vocabulary-states/issues/01-vocabulary-states.md`,无需再 grilling。
