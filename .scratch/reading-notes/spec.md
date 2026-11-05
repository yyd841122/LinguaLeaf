# reading-notes:阅读笔记——句块级 + 书级批注(进度/感受/思路/疑问)

Status: done

(clarify 管线收官 2026-11-04:grill 两轮 14 题拍板 → 票面整理 → Codex
review-plan 单轮评审 NEEDS REVISION 12 发现、引文全部现场重验属实 →
9 项工程裁决合并 + 2 道产品题维护者拍板 → 本票就绪。评审 threadId
`01a1a567-0cfb-71a3-a007-b070e2dd3d91`)

来源:维护者需求(2026-11-04):旧「打标签」与需求出入——只能落纯位置
标记,写不了内容、也指定不了精确落点。真需求:阅读时在任意位置落一笔
注,写进度、感受、思路、疑问,文中可回看、列表可纵览,助消化文章。经
grilling 两轮(现状探索 + 前沿推进)维护者全照推荐拍板,自述补充两点:
**只在桌面读、主要在 web 章节阅读器读**。

## 现状事实(2026-11-04 编排侧现场取数,非转抄)

- 全仓(web/server/kernel 范围)零自由文本输入面:阅读器无
  textarea/contenteditable,无 getSelection 处理(grep 缺席断言
  2026-11-04 成立)。GLOSSARY 现有三概念:标注(IPA/译文行)、书签
  (纯位置)、生词本(词级状态);本票新立第四概念「笔记 (Note)」,
  开工时随 ADR-0007 入册(adr 现止于 0006)。
- 书签 = (chapter, block) 纯位置标记:schema.ts:83-92(UNIQUE 去重、
  CASCADE;「names later (spec P4)」预留见 schema.ts:78);上限
  MAX_BOOKMARKS_PER_BOOK = 100(book-store.ts:540,路由侧报错
  books-router.ts:343);路由 GET/POST/DELETE books-router.ts:312/319/354;
  wire BookmarkSummary wire.ts:120-125;入口「打书签」
  ReadingPage.tsx:200-213(captureBookmarkTarget
  readingProgress.ts:84-88,落当前最上方可见块);列表在目录面板
  ReadingPage.tsx:260、284-290。
- 锚定原语:block position 是唯一现成持久坐标(blocks 表
  UNIQUE(chapter_id, position) schema.ts:63;DOM data-position
  annotated-blocks.tsx:85;wire SentenceBlockPayload.position
  wire.ts:63)。词身份仅 data-word 表面串,字符偏移瞬态,selection
  处理零起点;web 的 PDF 导入即抽平为文本章节,真版面 PDF 仅扩展有
  (本票出界)。
- 自动进度两宿主已有且本票不动:reading_progress(schema.ts:67-74)、
  恢复优先级「显式目标 → 自动进度 → 章首」(progressSession.ts:28)、
  书架「继续阅读 · 第 N 章」(BookshelfPage.tsx:252)。
- 重导入语义:web 每次上传无条件新建 book 行(books-router.ts:172 →
  createImportingBook),书签/进度不跟随;重导入 = 新书从零,原书及其
  笔记保留不动(决策 10)。
- 本票要绕开的三个现存形态(评审实证):bookmarks SQL 全程 NULL 敌对
  (读回 `= ?`、容量 `!=`,book-store.ts:609-624)——书级笔记的
  NULL 锚不可复用;bookmarksSession 换书即整表替换
  (bookmarksSession.ts:43-44 `setBookmarks([])`)——笔记有正文,
  整表替换会吞掉已完成的乐观写入;armJumpTarget 无落地回执
  (progressSession.ts:33/44)——跳转后直开浮层会量到旧坐标。
- 契约测试先例:书签段走真实客户端
  (contract.test.ts:461「bookmarks over the real server」)。
- notes 表现状缺席(schema.ts grep 2026-11-04 成立);SQLite 的
  UNIQUE 不约束 NULL(NULL 互不相等)——评审员 better-sqlite3 内存
  探针实证,书级唯一性须部分唯一索引(决策 9)。

## 决策(2026-11-04 维护者拍板;13/14 含评审后补拍板,共 14 项全定)

1. **本体**:新功能「笔记」,与书签共存互不干扰(不吸收、不替换)。
2. **锚点粒度**:(章, 句块)级为主 + 书级一条;字符级选中锚定不做
   (selection 零起点,数倍成本)。
3. **内容形态**:可选类型 + 自由文本,无结构化表单。类型四值:进度
   progress / 感受 feeling / 思路 idea / 疑问 question,默认 idea;
   类型仅徽标(供列表扫描),不影响任何行为。
4. **阅读进度**:自动续读已有不动;「进度」只是笔记类型之一,记自动
   进度给不了的信息(为什么停、卡在哪)。
5. **入口手势(仅桌面)**:块级行首一物两用按钮——无笔记时 hover 浮出
   浅色按钮,点击开笔记编辑;有笔记时常显**着色**按钮 + 块左侧细色条,
   点击回看/编辑。无触屏方案。
6. **编辑浮层**:popup-anchor 算术锚定(同查词弹窗,popup-anchor.ts:5-9
   常量同源);类型片 + 多行文本框 + 保存/删除;Esc/点外关闭;不做
   全屏编辑页。
7. **书级笔记**:单条,阅读器顶部可展开区,任何章节可见,同款浮层;
   进度与总感想都写这里。
8. **回顾-列表**:目录面板新增「笔记」分区,与书签并列:类型徽标 +
   正文前缀,按(章, 块)读序;点击跳转并打开该笔记。
9. **一块一笔记 + 每书一条书级(评审修订)**:块级
   UNIQUE(book_id, chapter_position, block_position);书级**部分唯一
   索引** UNIQUE(book_id) WHERE chapter_position IS NULL(SQLite
   UNIQUE 不约束 NULL,联合唯一键罩不住书级行);CHECK 章/块同空或
   同非空(禁半空锚)。同一句块多个思路并进一条文本。
10. **重导入(评审措辞修订)**:重导入生成独立新书、笔记不跟随新书
    (绑 book id,与书签/进度同命运);**原书笔记保留不动**,删书才
    级联删笔记。内容寻址另票。
11. **范围**:仅 web 章节阅读器;扩展/PDF 表面、触屏不在本票。
12. **AI**:第一版不参与,纯手动。
13. **编辑浮层生命周期(评审后拍板)**:状态机 干净/脏/保存中/保存
    失败/删除中;**脏态 Esc/点外关闭弹「放弃修改?」确认**(维护者
    2026-11-04 拍板);保存失败保文本 + 失败提示可重试(参照查词弹窗
    saving-disabled + 失败通知形态);浮层全站互斥,一次只挂一个。
14. **书级横幅形态(评审后拍板)**:**窄横幅常驻**——工具栏下、章
    内容前,不 sticky;无笔记时「写文章笔记」淡入口;有笔记时显示
    类型徽标 + 正文前缀 + 更新时间,点击展开/收起全文,展开态有
    「编辑」按钮唤浮层;目录分区中该行标「文章笔记」,点击滚顶 +
    展开横幅。

Lane: **B**(纯 TS/React、票面自包含、沙箱内可验证;HTTP seam listen
EPERM 假失败已由 .cc-suite.md 声明,全量测试与 verify 留编排侧补跑)。

## 技术骨架(实现参照;API 矩阵与 SQL 纪律为评审裁决定值)

### 数据
- SQLite `notes` 表:id AUTOINCREMENT、book_id REFERENCES books(id)
  ON DELETE CASCADE、chapter_position/block_position 可空对(决策 9
  CHECK 同空或同非空)、type TEXT NOT NULL CHECK 四值、text NOT NULL、
  created_at/updated_at TEXT NOT NULL、块级 UNIQUE(book_id,
  chapter_position, block_position)、书级 partial UNIQUE(book_id)
  WHERE chapter_position IS NULL。迁移沿用「new is the table's
  absence」惯例(旧库开库生长,迁移测试进验收)。
- 数量上限沿用书签模式:常量 + 路由报错,**计所有笔记含书级行**,
  值实现时定(参照书签 100);PUT 编辑不受容量限,仅创建受限。

### SQL 纪律(评审 D3-5)
- **不可照抄书签 SQL**:读回 `= ?` 与容量 `!=` 均 NULL 敌对
  (book-store.ts:609-624);书级分支用 IS NULL 显式路径。
- 创建路径:锚存在性、容量、INSERT 同事务;DELETE 双限定
  book_id + id(同 deleteBookmark 形态,天然幂等 204)。

### API 矩阵(评审 D4-8:不复刻书签「重复即 no-op」——那会静默吞新文本)
- `GET /api/books/:id/notes` → `{ notes: NoteSummary[] }`,按
  (章, 块)读序,书级行排最前。
- `POST /api/books/:id/notes` body `{ chapter?, block?, type?, text }`:
  type 缺省 idea;锚须存在于本书 blocks(四类块皆可,校验含块种类
  无关);书非 ready 拒(跟随书签守门);同块已有笔记 → **409 带既有
  NoteSummary**(客户端转编辑);容量满 409;空/纯空白 text 400;
  超文本上限 400(值实现时定)。
- `PUT /api/books/:id/notes/:noteId` body `{ type, text }` **全量
  替换**;**锚不可变**(挪位 = 删旧建新);book + id 双限定,不属本
  书 404。
- `DELETE /api/books/:id/notes/:noteId`:book + id 双限定,幂等 204。
- wire `NoteSummary {id, chapter: number | null, block: number | null,
  type, text, createdAt, updatedAt}`;请求/响应/错误码类型跟随书签的
  stable-error-code 形态(wire.ts:127 一带的既有惯例)。

### kernel 与浮层
- 块级按钮进共享 `AnnotatedBlockView`(annotated-blocks.tsx:85-120
  四类块同 data-position 面,sentence/code/raw/image 全支持);prop
  开关,不传即零渲染(扩展宿主后续白捡);两态样式落点实现时定。
- 浮层**固定几何遵循 popup-anchor 常量契约**(288px 宽、≤256px 高、
  内部滚动,不参数化几何);textarea 禁自由 resize——几何参数不
  符合契约则 clamp 失真(评审 D3-6)。
- 浮层状态机(决策 13)由浮层组件自治,操作结果(成功/失败)由会话
  回传。

### 会话与次序(评审 D5-11)
- notes 会话**不复刻 bookmarksSession 整表替换**(:43-44 在笔记场景
  会吞已完成写入):初始 GET 未落定前写操作禁用或挂起;refetch 以
  (id, updatedAt) 逐行合并,不回退本地较新状态;每笔记操作串行
  (挂起中禁再编辑/删);owner 票沿用 useOwner(useOwner.ts:12-20
  版本票形态);书 A→B→A 换书即清空本地集合(owner.invalidate
  语义,同书签)。

### 列表跳转(评审 D3-7)
- 目录行点击设 **pending open intent**(book/note/锚/操作标识),
  章内容 + 显式跳转 + 滚动**落定后**消费(armJumpTarget 无落地
  回执,不可直开),消费时量目标按钮开浮层;覆盖同章、跨章、快速
  连点(后点胜)、导航失败(intent 作废)。

### web 集成
- 书级横幅(决策 14)、目录「笔记」分区(参照书签分区
  ReadingPage.tsx:284-290)、notes 会话挂 ReadingPage
  (参照 bookmarksSession 接线形态)。

## 实现次序(评审 D5-12)

1. 锁 schema + API 矩阵 + 浮层状态机(测试先行)。
2. 薄切片:存 → 载 → 跨章目录跳转 → 落定开浮层,真机过一眼。
3. 铺表现层(两态样式、横幅、列表分区)。
4. 收尾:真实客户端契约测试、旧库迁移测试、会话竞态组
   (delayed GET / 连打保存 / 存删竞速 / A→B→A)。

## 验收门

- 测试覆盖:store/router CRUD + 409 矩阵(同块重复/容量满/非 ready)
  + 400 组(半空锚/空文本/超限/类型非法)+ CASCADE + 双 UNIQUE + 书级
  读回与容量计数;wire 形状;kernel 四类块两态渲染与点击;web 集成
  (hover → 浮层 → 保存 → 着色 + 左条;脏态关闭确认;保存失败重试;
  目录分区跳转含跨章;书级横幅展开/编辑;书签零回归);真实客户端
  契约测试(跟随 contract.test.ts 书签段模式);旧库迁移;会话竞态组。
- 编排侧(caller)补跑 `npm run verify`,以退出码为门(tail 不作数)。
- 评审基线:「本票首个实现 commit 之前的 HEAD」(写关系不写 SHA)。
- **人工浏览器抽验(收尾检查点,翻 done 前必做)**:① hover 浮出 →
  写 → 着色 + 左条;② 点击回看/编辑/删除;③ 目录「笔记」分区跳转
  (含跨章);④ 书级横幅:任何章节可见、展开、编辑;⑤ 重导入同书 →
  新书无笔记且**原书笔记不受影响**(预期行为确认);⑥ 书签零回归;
  ⑦ 脏浮层 Esc → 「放弃修改?」确认出现。
- 翻 Status 三件套(人工):caller 补跑 verify 记账、抽验归档进
  Comments、Status 翻 done。

## 不做清单(本票出界)

字符级选中锚定 · 扩展/PDF 表面 · 触屏 · AI 辅助 · 跨文章汇总页 ·
笔记导出 · 重导入保笔记 · 书签改造 · 导出 HTML 携带笔记 ·
草稿本地暂存(拍板弃选,关闭确认已覆盖丢字风险)

## 挂账候选(按需立 needs-triage stub)

重导入内容寻址保笔记 · 扩展 + PDF 笔记 · AI 摘要/导读 · 笔记导出 ·
跨文章汇总页

## Comments

### 2026-11-04 立票(编排侧)

- grill 两轮(Q1–Q14)维护者全照推荐;两轮间事实注解(旧「打标签」=
  书签、自动进度已有、锚定原语只有块级)已并入决策。
- 行号核对注:探索代理转抄 MAX_BOOKMARKS_PER_BOOK 报 book-store.ts:536,
  现场重取为 :540——按 tracker 规则本票 file:line 全部现场取数,转抄
  一律重验。

### 2026-11-04 评审合并 + 拍板收官(编排侧)

- review-plan(Codex gpt-6.1-sol/high/read-only,threadId
  `01a1a567-0cfb-71a3-a007-b070e2dd3d91`,job
  `review-plan-mw1s4mnj-f7zgsf`)verdict **NEEDS REVISION**,12 发现
  (6 High / 6 Medium)。全部引文编排侧现场重验**属实**(含 SQLite
  NULL 唯一性内存探针);零虚报。
- 裁决去向:①书级唯一性 bug → 部分 unique index + CHECK(决策 9);
  ②重导入措辞 → 决策 10 + 验收⑤;③浮层生命周期 → 产品题拍板
  (决策 13);④输入完整性 → API 矩阵;⑤书签 SQL 不可复用 → SQL
  纪律节;⑥浮层几何 → 锁 288 契约;⑦跳转后开浮层 → pending open
  intent;⑧API 语义 → 矩阵(重复 POST 409 转编辑);⑨块种类 → 四类
  全支持;⑩书级导航 → 产品题拍板(决策 14);⑪会话次序 → 会话节;
  ⑫实现次序 → 实现次序节。
- 产品题 2 道维护者拍板(2026-11-04):脏浮层关闭**需确认**;书级
  **窄横幅常驻**。
- 管线收官:Status 翻 `ready-for-agent`。下一步 Lane B 实现
  (/cc-suite:implement 或 codex-runner 直调)→ 编排侧补跑全链 verify
  → 双轴评审 → 人工抽验 → 收官。

## 增量修订(2026-11-05 维护者四题拍板,全照推荐;本节覆盖上方被修订条目)

背景:v1 落地并真机抽验全绿后,维护者提出类型升级——四类型
(进度/感受/思路/疑问)从「徽标」升为**记录维度**:分别记录、分别
展示、分别保存。以下修订与 2026-11-04 决策冲突处,以本节为准。

1. **修订决策 3/9(类型即维度,一块每类型一条)**:笔记唯一键全面加
   type——块级 `UNIQUE(book_id, chapter_position, block_position, type)`
   (一块最多 4 条,每类型各一);书级部分唯一索引改
   `UNIQUE(book_id, type) WHERE chapter_position IS NULL`(书级每类型
   一条,至多 4 行)。CHECK(章/块同空或同非空)与四值 CHECK 不变。
   类型不再有缺省——分区即类型,POST 的 type 必填。
2. **修订决策 5(按钮两态语义不变,含义变宽)**:行尾仍**单枚**
   ✎ 按钮(段尾随文形态保持,2026-11-05 上午修订不回退);`has-note`
   = 该锚**任一类型**有内容。多类型不加多按钮。
3. **修订决策 6/13(浮层四分区)**:点击按钮开**四分区浮层**——四个
   类型分区(并列布局,实现可纵向堆叠或等宽栏),每分区:类型标题
   (按类型着色)+ 该类型文本(有则回显,无则空)+ 独立 保存/删除;
   有内容的分区亮标。状态机升级为**每分区独立** dirty/saving/failed
   (任一分区 dirty 时 Esc/点外仍弹「放弃修改?」,放弃即弃全部未存
   分区);删除仅删该类型行。浮层互斥、Esc/点外、失败重试语义照旧。
4. **修订决策 7/14(书级同构拆四类)**:「文章笔记」横幅展开后亦为
   四分区(同组件复用),每类型各一条各存各的;横幅折叠态摘要与
   更新时间照旧(任一类型有内容即显)。
5. **类型颜色(新增)**:四类型各有固定色(色值实现时定,须过对比
   度可读),用于**浮层分区标题**与**目录列表徽标**;文中左色条保持
   统一绿 #5f8a62(多类型不拼色,拍板定论)。
6. **API 矩阵增补**:POST body `{chapter?, block?, type, text}`,
   type 必填且四值之一;同锚**同类型**已存在 → 409 带既有 NoteSummary
   (客户端该分区转编辑);同锚异类型照常创建。PUT 仍全量替换
   `{text}`(type 与锚均不可变;改类型 = 删旧建新)。GET 返回该锚/
   该书全部类型笔记,读序(章, 块)不变、同块按类型固定序
   (progress → feeling → idea → question)、书级行仍排最前(同
   类型序)。其余(cap 计全体、双限定、幂等 204、错误码形态)照旧。
7. **存量迁移(硬要求)**:v1 已建 notes 表(表内
   UNIQUE(book_id, chapter_position, block_position),SQLite 无法单
   独 drop 表内约束)→ **表重建迁移**:按 PRAGMA index_list/index_info
   检测 notes 唯一索引是否已含 type,未含则建新表(新约束全集)→
   `INSERT INTO ... SELECT` 拷贝(存量每块恰一条,type 各异,无键
   冲突,拷贝无损)→ drop 旧表 → 改名。守门沿用「new is the
   table's absence」+ 本重建检测双形态;迁移测试三态:无表库生长、
   v1 旧表无损重建(数据逐行比对的断言)、新表幂等跳过。
8. **测试覆盖增补**:per-type UNIQUE(同锚同类型 409、异类型 201)、
   三态迁移组、四分区浮层(独立保存/独立删除/任一 dirty 关闭确认/
   分区亮标)、书级四分区同构、列表同块多类型多行与固定类型序、
   类型徽标着色挂载点。

## Comments

### 2026-11-05 增量拍板(编排侧)

- 七项真机抽验**全绿**(维护者 2026-11-05);段尾修订(commit
  `d4d79b6`)verify EXIT=0 后落定,随本增量一同回归抽验。
- 维护者提出类型升级需求,四题拍板全照推荐(每类型各一条 / 单按钮 +
  四分区浮层 / 书级同构拆四类 / 浮层+列表着色、左条统一);修订条目
  见上方「增量修订」节。本票 Status 维持 ready-for-agent,Lane B 增量
  实现,完成后照旧编排侧 verify + 双轴评审 + 抽验收官。

9. **修订第 3/4 条的呈现层(2026-11-05 第二轮,维护者拍板)**:四分区
   并列改**标签页**——tab 栏四标签(类型名,类型色文字,有内容加 ●
   亮标),一次只渲染选中类型的分区,点标签切换。默认落点:首个**有
   内容**的类型(按固定类型序),全空落「进度」。切标签**不触发**脏
   确认(草稿在浮层存活期内按类型保留于内存,与第 3 条状态模型一致);
   Esc/点外确认与放弃语义不变。a11y 用原生 tab 语义
   (role=tablist/tab/tabpanel + aria-selected);单分区渲染天然符合
   popup-anchor 288×256 高度契约。NotePanels 单组件改造,书级横幅
   自动同构;服务端零触碰。

### 2026-11-05 第二轮拍板(编排侧)

- 维护者需求原话:四类型「用标签显示,不要全部展示。需要哪个我点击
  即可」。编排侧补默认落点(首个有内容类型,全空落进度)、切标签不
  触发脏确认、原生 tab 语义三项实现细则,属呈现层,不另开拍板轮。
- 上一轮增量(`0914e02`)的真机抽验由维护者尚未执行,折叠进本轮
  结束后的统一抽验清单。

### 2026-11-05 收官(三轮真机抽验归档,Status 翻 done)

- 维护者真机抽验**全绿**(2026-11-05,统一清单八项):标签页切换与
  草稿跨切保留、每类型独立存取(保存不关浮层)、脏守 Esc 确认、
  v1 旧笔记无损迁移(表重建迁移真机验证)、同块多类型列表徽标与
  固定类型序、书级横幅同构标签页、段尾随文按钮(首轮欠项补验)、
  书签零回归。
- 账目五 commit:`c961400` 票面(clarify 管线:grill 14 题 +
  review-plan 12 发现合并 + 2 产品题)→ `5256ccc` v1 实现 →
  `d4d79b6` 段尾修订 → `0914e02` 类型即维度增量 → `5f26fed`
  标签页增量。
- 全链 verify 三轮 EXIT=0:661 → 673 → 680(659→671→678 passed|2
  skipped,各轮基线递进对齐)。
- 双轴评审三场:v1 场(vs c961400)12 发现合并+2 产品题拍板;增量场
  (vs d4d79b6)零硬违规、stale 卡死分支编排侧当场修(NotePanels
  stale 回落可编辑态);标签页场(vs 0914e02)零硬违规零当场修。
  各场 judgement-call 记档不修清单见对应 commit message。
- Lane B 三发:threadId `01a1a57b-34f9-7341-80bc-350e455a8aff` /
  `01a1a989-6e59-7793-8ce8-37851cf26596` /
  `01a1a9bc-e21e-7830-a9a9-5dc2d4e0375e`;守态全程
  watch-codex-job.mjs,沙箱零触碰 .scratch 零 commit。
