# 05 备份/恢复:全量 JSON 双端手动互通
Status: done(2026-11-13 维护者确认人验「确认」翻 done:保存到本机+导入闭环过;Codex 独立终审 11-15 额度恢复后补跑,见 Comments 末条)
Blocked by: 02(与 04 并行,双轨)

## 目标

学习者资产优先的全量备份/恢复:生词本四态、笔记、阅读进度、书签;手机侧导出+导入,PC web 端加全量导出路由。迁移路径 = PC 导出 → 手机导入。

## 范围

- 备份内容必含:生词本(跨书资产)、笔记、阅读进度、书签;书原文件可选含(默认不含:书在手机侧重导,导入即重新生成音标)
- 备份文件带版本字段,向后兼容留门
- 手机侧:导出(存文件/系统分享)+ 导入(选文件 → 校验 → 落库;损坏文件拒绝且报错可读)
- PC 侧:apps/server 全量导出路由(books-router 旁)+ web 入口(api.ts 加一法)
- 不做自动同步(D8 拍板);导入冲突语义票内写清粒度(整库覆盖 vs 按资产合并,实现时定并记录)

## 验收门

- 根 verify EXIT=0
- 真机【人验】:PC 导出 → 传手机 → 导入,生词本/笔记/进度/书签全部落位;损坏文件导入被拒

## 用户操作项(人做)

- PC web 端导出备份,传入手机完成一次真实迁移 —— **已完成
  (2026-11-13 维护者「确认」;手机侧保存到本机→导入闭环亦过)**

## Lane(领票时定,2026-11-10;2026-11-13 翻 Lane A)

版本化 JSON + PC 全量导出路由以纯 TS 为主,沙箱可实现 → 领票时定
**Lane B**(`/cc-suite:implement`)。**2026-11-13 维护者拍板翻 Lane A**
(Claude 直接实现)——Codex 额度 11-15 10:55 恢复后补独立终审,同票
10 先例;发现实项按 follow-up 处置。

## Comments

### 2026-11-10 领票前注(编排会话留档,clear 前固化)

「备份必含书签」与票 10(needs-triage:手机端书签未实现,扩展基座无可搬)
存在顺序茬——手机侧书签现为空集,PC 导出的书签在迁移链路里无处落。领票时
二选一:(a) 票 10 先定夺提前排;(b) 05 照写(书签字段在、手机侧空落),
导入冲突语义票内写明「书签段手机侧忽略/暂存」。

**拍板回写(2026-11-11)**:维护者选 **(a) 提前**——票 10(EPUB 书签)先于
本票落地,已翻 ready-for-agent(Lane B);本票领票时书签有实体可备,门原样
过,勿再走 (b) 分支。跨端书签 id 域冲突(10 用本地自增 id,PC 用服务端 id)
的合并语义在本票导入侧写清并记档。

### 2026-11-13 领票拍板(Lane A;格式/语义/机制四项)

1. **备份格式 v1**(版本字段向后兼容留门):
   `{app:"lingualeaf-backup", version:1, exportedAt, books:[{title}],
   assets:{vocabulary, notes, progress, bookmarks, translations}}`
   - **跨端 join key = 书名**:手机 docId=`doc:${title}`
     (ReaderPage.tsx:285),PC 是自增 book_id(schema.ts)——设备本地
     id 一律不进格式;书签导入按位置重铸本地 id(同位幂等去重),
     即票 10 移交的合并语义
   - vocabulary 跨书:lemma→status 扁平 map(两端同形:PC word_states
     lemma TEXT PRIMARY KEY / 手机 vocabulary namespace record)
   - notes 行 {bookTitle, chapterIndex, blockIndex, type, text};
     PC 书级笔记(锚 null)手机无处落,导出跳过并计数
   - translations 是必含四项之外的加项:DeepSeek 付费产物不可再生,
     「学习者资产优先」原则涵盖
   - **PDF 资产(pdf-notes/positions/bytes)本票不含**:PDF 链条票 03
     未落地;版本门留扩展位
   - **设置不进备份**:翻译 API Key 是密钥,不落备份文件
   - 书原文件不含(票面默认):手机重导书,docId 按书名重挂,音标重算
2. **导入冲突语义(票内拍板:按资产合并,非整库覆盖)**:
   - 校验先行:payload 结构全过才动库;损坏 → 一条可读错误,零写入
   - vocabulary 按 lemma upsert(PC 胜);notes 按 (title,chapter,block,
     type) upsert(store.save 天然);progress 按 title 覆盖(PC 胜,
     迁移方向 PC→手机);bookmarks 按位置 add(幂等重铸 id);
     translations 按 (title,chapter,block) 合并(PC 胜)
   - 每书笔记超手机 100 条上限的尾部跳过并在导入摘要里报数
3. **导出机制(手机)**:@capacitor/filesystem 写缓存 + @capacitor/share
   系统分享(票面「存文件/系统分享」);适配器缝注入,jsdom 打 memory
   twin。导入 = 文件选择器 → FileReader 读文本 → 校验 → 落库。
   **追加(2026-11-13 人验反馈)**:导出加「保存到本机」为主按钮——
   自写 30 行原生插件 SaveToDownloads,MediaStore 插入共享 Downloads
   集合(Android 10+ 免存储权限),文件落在文件管理的下载目录;分享
   降为辅按钮「分享备份」。状态行报文件名。
4. **PC 侧**:GET /api/export/backup(ADR-0008:20 点名的导出路由)组装
   同格式 JSON(listShelf/getProgress/listBookmarks/listNotes/
   loadWordStatuses);web 书架页「导出备份」按钮复用 download.ts 的
   fetch→Blob→anchor。

### 2026-11-13 Lane A 实现收官(commit `feat(backup)` 32 文件)

**门**:根 verify **EXIT=0**(103 文件,1133 passed | 3 skipped,+3 文件
+19 测试);`eslint --max-warnings 0` 过;`check:sql-locality` 过(blocks
表查询归位 book-store 的 `listSettledTranslations`,路由只收行)。

**实现中发现并钉死的跨端事实**:PC 库坐标是 **1-based**
(persistBook chapters `chapterIndex+1`、blocks 从 1 起;路由
`isPositiveInteger` 拒 0),手机是 **0-based**(数据块下标含全部块)。
格式钉死手机语义 0-based,PC 导出路由 -1 换算,wire.ts 类型注释钉约定;
书签店「mirror wire」注释补「形状同、值差一」澄清。

**三端**:手机(五店 exportAll 读缝双孪生 / backup-format 校验器 /
backup 编排器 / manager(FileReader 读文件,jsdom 全版本姿势;测试抓出
File.text() 缺失的坑)/ Capacitor Filesystem+Share 适配器 / 落地面
备份与恢复区);server(export 路由 + supertest 2 例,书级笔记跳过走
X-Backup-Skipped-Book-Notes 诊断头);web(书架导出备份按钮 +
bookshelf.test.tsx 2 例,复用 ticket-03 导出 harness)。

**勿忘**:
①真机【人验】:PC web 导出备份 → 传手机 → 书架导入备份,生词本/
笔记/进度/书签/译文全部落位;损坏文件导入被拒且报错可读。**已过
(2026-11-13「确认」),翻 done。**
②**Codex 独立终审 11-15 10:55 额度恢复后补跑**(Lane A 翻转挂账,
同票 10,两笔一起),范围=本票实现 commit + 拍板;发现实项按
follow-up 处置。

### 2026-11-16 Codex 独立终审(挂账补跑)

threadId `01a1e1e9-f7c3-7550-927e-9e06deee6655`,verdict **NO-GO**,只读
含校验器/manager 探针。已排除 02 终审所立续读竞态簇(不重复报告)。
发现全走 follow-up:
- 发现 1(SaveToDownloads 未注册,P1)→
  `.scratch/save-to-downloads-unregistered/`(编排侧 git 追溯:自
  scaffold 生来未注册;与 11-13 人验记录矛盾待真机复按澄清)
- 发现 2+3+4(校验零写入失守/译文键未校验/导出书名键原型污染)→
  `.scratch/backup-integrity-defects/`
- 缺口 5+6 → 并入 `.scratch/mobile-test-evidence-gaps/` ⑦⑧
生词四态/四型笔记/书签幂等/合并实现/wire 双端形状均 PASS。05 维持 done,
实项随 follow-up 票处置;建议拍板时优先 1(真机功能缺失)与 2(零写入
承诺失守)。
