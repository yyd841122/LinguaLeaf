# 生词本四态:词元状态表 + 弹窗状态操作 + Known/Ignored 视觉弱化

Status: ready-for-agent
Type: task

按 `../spec.md` 落地,领域规则以 `docs/adr/0005-vocabulary-four-state-model.md` 为准。
动工前先跑一轮 grilling:状态表落点(book-store 内还是独立 module)、lookup 自动迁移的
写入口、弹窗操作的 API 形状——spec 只给了方向。

## Comments

### Grilling 决策(2026-10-24,六项全数与维护者对齐锁定)

1. **状态跨书**:`word_states` 按 lemma 主键,无 book_id——「会一个词」在哪本书都会,状态是学习者资产(GR ADR-012 本义)。
2. **落点**:新建 `vocab-store.ts` 持有 word_states 全部 SQL + 唯一列清单常量(DDL 照惯例进 schema.ts),不折进 book-store——书数据与学习者数据不是一个领域,dict/(自己的库自己的 router)是先例。`check-sql-locality.mjs` 从单一表集合扩成「表 → 属主文件」map,`word_states → vocab-store.ts` 钉进门禁,「One table, one column list」对新表继续生效。
3. **自动迁移写入口**:`GET /api/lookup/:word` 命中且状态行不存在时,服务端同请求内插入 `learning`(缺席 = New,纯 insert,无更新路径);已存在(含 known/ignored)一律不动;404 未命中不写。规则单侧服务端,前端零逻辑;router 构造时注入 states store。
4. **操作 API**:`PUT /api/vocab/lemmas/:lemma` 幂等设态 `{status: learning | known | ignored}`,`DELETE` 同路径回 New(删行)。服务端不建迁移矩阵,合法迁移只由弹窗操作集表达:任何态可显式标 Known / 标 Ignored / 回到 Learning——与 ADR 0005「Known/Ignored 只能显式迁移」一致。
5. **弱化通道**:章节 GET 响应为每个 word token 附带状态(服务端复用 `tokenizeWords` + `lemmaOf` 做 join),前端拿到即渲染、不做词形还原。v1 不给 token 存 lemma 列(不镜像 ipa_slots);本地点查一章几千 token 应无感,真慢了另开票加缓存列。
6. **弱化视觉**:Known/Ignored 的词只去掉 hover 底色(收回查词 affordance),词色、音标渲染一律不动;更大的视觉动作等实际使用反馈再说。

新会话可直接 `/implement .scratch/vocabulary-states/issues/01-vocabulary-states.md`,无需再 grilling。
