# pdf-shelf:PDF 原书字节本地持久化(免重选书架,IndexedDB,离线本地)

Status: ready-for-agent(2026-11-07 clarify 管线收官:grill 三题 + review-plan 14 发现合并 + 维护者确认开工。同日即发 Lane B)
拍板单待维护者终审确认。确认前零改动)

来源:pdf-notes 决策 1 点名的后继票(「免重选(IndexedDB/OPFS)
另票」)。ext-note-types 收官当日(2026-11-07)维护者拍板开工。
动机:现在重开扩展必须重新选一次 PDF 文件才能回到书里——体验毛刺。

Lane:B(纯 TS、沙箱可验证——IndexedDB 经注入 backend 测试,真
IndexedDB 留冒烟真 Chromium;grill 时即定)。

## 现状事实(2026-11-07 编排侧现场取数,评审复核后修正)

- **重选回挂链现状**:用户选文件 → 字节 sha256 指纹先于解析
  (ReaderPage.tsx:213-217 `pdfFingerprint(bytes)` → `openPdf`)→
  同 docId 静默回挂笔记+位置恢复。字节只活在内存,重开即失。
- **字节所有权雷区(评审 6)**:openPdf 把 ArrayBuffer 直接交
  pdfjs(pdf.ts:44-48);指纹函数头注明示警告「it may
  transfer/detach it」(pdf-fingerprint.ts:3)——openPdf 返回后
  原 buffer 可能已 detach,事后构造 Blob 可抛。
- **openPdf 成功 ≠ 接受进阅读态(评审 9)**:其后仍有 scanned
  抽样校验(sampleTextLengths,ReaderPage.tsx:225-228)与 owner
  裁决(acceptedSession/ticket)——存字节触发点须在**接受之后**。
- **空态提示现状**:`PdfRecent = PdfPosition & { title }`
  (pdf-position-store.ts:6-7),最近会话纯提示不可点
  (ReaderPage.tsx:669-675),与 EPUB recents 并存。
- **position store 无失效操作(评审 5)**:API 仅
  getPosition/getRecent/setPosition(pdf-position-store.ts:9-11),
  删除书架项后 recent 记录无法按 docId 清除——需新增操作。
- **getPosition 每次读全量记录**(pdf-position-store.ts:83 起,
  pendingWrite 后 decode 全记录再过滤)——书架逐项查页码会平方级。
- **EPUB 已免重选**:library.saveDocument 存 ExtBook JSON
  (ReaderPage.tsx:262-264),recents 点击重开(:323、:649-650)
  ——EPUB 无需本票。
- **全仓零 IndexedDB / navigator.storage 使用**(grep 零命中)
  ——本票引入首个 IDB 使用点。
- **manifest 现状(评审 8 修正)**:已声明
  `"permissions": ["contextMenus", "storage", "tabs"]`
  (manifest.json:13)——票面原稿「零存储类权限」有误;正确前提 =
  已有 storage、无 unlimitedStorage、**IndexedDB 无需任何额外权限**。
- **chrome.storage.local 不可行**:总配额 10MB(pdf-notes 现状
  事实),PDF 字节 MB 级装不下。
- **注入纪律现成**:NamespaceStorage memory 注入测试两 store 同款;
  library seam 可注入(ReaderPage.tsx:188-194)——IDB wrapper 照此。
- **smoke 边界(评审 14)**:smoke 跑在 localhost 源,「重开」用
  page.reload()(smoke.mjs:616),chrome.* 是 sessionStorage 假身
  (:678-682)——**扩展 origin 的关页/重启持久性只有真机能证**。
- **字节与笔记/位置天然独立**:notes/positions 按 docId 存,删字节
  不动笔记;pdf-notes 决策 6「历史身份笔记不可达但不删除」是删除
  语义先例。
- **scale 是三值枚举** [0.75, 1, 1.5](pdf-position-store.ts:35)。

## 决策(2026-11-07 维护者拍板三题,全照推荐)

1. **入口 = 可点开的书架**:空态页「最近 PDF」升级为真入口——列出
   存过字节的 PDF(title+页码),点击直接取字节走既有指纹→回挂链,
   笔记/页码/缩放全恢复;EPUB recents 并存互不扰。
2. **配额 = 申请持久化 + 不设自造上限**:`navigator.storage.persist()`
   失败良性降级;配额浏览器自管;真超配额可见失败,**不拦阅读**
   (重选路径永在)。
3. **清理 = 书架每项带删除(×)**:删字节 + 书架项,直接删无确认
   (原件在用户手里,字节是副本);笔记/位置记录保留——重选同文件
   仍回挂,书架重现。

## 工程裁决(review-plan 14 发现合并后定稿)

- **a. 字节所有权(评审 6)**:picker File/Blob **先于 openPdf 保底
  持有**——openPdf 只接收派生副本(Blob.arrayBuffer()),原 Blob 留
  在编排侧;缓存打开时给 pdfjs 独立副本,检索到的 Blob 不交出去;
  存前校验 size 与摘要一致才提交。
- **b. 事务契约(评审 4)**:字节+元数据同一 IDB transaction;
  mutation 在 transaction complete 上 resolve、abort/error reject;
  「存中关扩展」= 观察到旧完整记录或新完整记录二者其一,绝无半截;
  定义 db version/open/upgrade 与连接清理。memory backend 证不了
  此行为——原生窄证明前移(裁决 k)。
- **c. 失败语义分层(评审 1/3)**:插入失败=无条目;**替换失败=旧
  条目原样保留**(含 storedAt),不得为措辞删既有副本;库开/列表/
  字节缺失/Blob 读/畸形记录失败 ≠ 空书架——独立失败态可重试;
  删除失败不假装成功,行在提交后才移除;picker 永在;缓存打开前
  现算 docId 与所选键比对不符即拒。存储失败可见形态 = 轻量行内
  提示(Open Q4 落定)。
- **d. 存储时机两段式(评审 9)**:字节保底从 picker 处开始(原
  Blob 持有),但**书架提交**在候选通过 scanned 校验 + owner 裁决
  被接受之后——保底 ≠ 入架,拒绝/取代的候选不留书架条目。
- **e. per-docId 变更排序(评审 12)**:同 docId save/delete 串行
  (含事务前准备),后删必胜过早存;跨书乱序结果不进当前书 UI;
  落回裁决只管 UI 更新;提交式 mutation 后刷新当前列表;钉测
  delayed-save→delete 与「save 未完返回 picker」。
- **f. 书架数据源与性能(评审 7)**:bytes store 提供 metadata-only
  列表操作(绝不把每个 Blob 读成 ArrayBuffer);页码用 position
  一次快照 join;点开才读字节。
- **g. 提示并存与删除联动(评审 2/5)**:无字节但有位置/笔记的最近
  身份——保留不可点「选同一个文件继续」提示(前票决策 7 行为),
  有字节的书架项不再重复提示;position store 新增串行
  `clearRecentIf(docId)`(只清该书 recent,不动其他书位置);字节
  删除与 recent 清理无共享事务——顺序 = 先字节后清理,清理失败
  可重试不阻塞(下次删除或重选同文件自愈)。
- **h. persist() 纪律(评审 10)**:每次 reader mount 一次(共享
  promise);显式处理 true/false(rejection)/promise reject/API
  缺失四种结局;全在阅读关键路径外;denial 与 rejection 分开测。
- **i. 幂等与缓存打开(评审 11)**:picker 导入 = 写 Blob+元数据
  (同 docId 替换刷新 storedAt,Open Q1 落定);**缓存打开不重写
  Blob**(只更新位置);书架项 = title+页码(Open Q2 落定);
  删除无 confirm(Open Q3 落定,维持拍板 3)。
- **j. 冒烟与真机边界(评审 14)**:smoke(localhost+真 IDB/Blob)
  证原生行为;**真机检查点**补 load-unpacked 关页重开与浏览器重启
  ——扩展 origin 持久性只有真机能证,冒烟不冒称。
- **k. 原生窄证明前移(评审 13)**:store seam 落地后立即在真
  Chromium 证明 import→commit→读字节→摘要比对→reload→免选重开,
  并注入 abort/延迟失败——先证核心链再扩 UI;组件测试注入失败与
  延迟操作。
- **l. 零回归与零触碰(评审 8 修正)**:不新增权限、不加
  unlimitedStorage(已有 storage 够用);web/server/kernel 零触碰;
  EPUB 面零回归;PDF 点词键盘、音标、四类型笔记、重选回挂全保持;
  GLOSSARY 补「书架」句。

## 实现顺序(评审 13 重排:原生证明紧随 store)

1. `idb-bytes-store.ts`:事务契约 b + 失败语义 c + metadata list f,
   注入 backend + memory 单测;
2. **窄浏览器证明**(真 Chromium):import→commit→摘要比对→
   reload→免选重开 + abort/延迟注入——核心链先立;
3. 字节所有权接线:picker Blob 保底 a + 接受后提交书架 d +
   persist h;
4. 书架 UI:数据源 f + 无字节提示并存 g + 失败态重试 c + per-docId
   排序 e + clearRecentIf;
5. 删除(字节+书架项+recent 清理 g)+ 回归(EPUB/点词/四类型/
   重选)+ GLOSSARY + smoke 扩(j 边界如实标注)+ verify + 真机
   检查点。

## 验收骨架(自验清单,评审后扩)

重开扩展书架列出最近 PDF、点击免选回书且笔记页码缩放全恢复、书架
与 EPUB recents 及无字节提示三者并存互不扰、同文件重存幂等单条、
删除书架项字节删笔记留(重选同文件仍回挂书架重现)、替换失败保旧
条目、读失败可见可重试非空书架、删除失败不假装成功、存中关扩展只
见完整记录(事务契约)、缓存打开不重写字节、persist 四结局显式处理、
真超配额可见失败不拦阅读、per-docId 后删胜过早存、EPUB 面零回归、
四类型笔记零回归、点词键盘音标零回归、不新增权限无 unlimitedStorage、
GLOSSARY 书架句、真机关页重开与浏览器重启两项检查点。

## Comments

### 2026-11-07 grill(编排侧,AskUserQuestion 三题)

- 三题全照推荐拍定:可点书架入口 / 申请持久化不设自造上限 / 每项
  带删除。Lane B 即时选定(单测注入 memory backend,不引
  fake-indexeddb;真 IndexedDB 断言落冒烟真 Chromium + 真机)。
- 前置:无——ext-note-types 已 done,实现可即开。

### 2026-11-07 review-plan(NEEDS REVISION 14 发现,已合并)

- job `review-plan-mw5o646l-v2fkfx`,threadId
  `01a1b36c-287b-70e3-aa9a-285da6c2364c`,gpt-6.1-sol/high/
  read-only。评审自述核对了 IndexedDB 规范事务生命周期与
  pdfjs 4.10.38 buffer transfer 行为。
- 编排侧承重引文逐条现场核验属实:①评审 6——pdf-fingerprint.ts:3
  头注「it may transfer/detach it」+ openPdf 直交 buffer;②评审 8
  ——manifest.json:13 已有 `"storage"`,票面「零存储类权限」系
  编排侧事实错误当场修正;③评审 5——position store API 三操作无
  clear;④评审 9——openPdf 后仍有 scanned 校验与 owner 裁决;
  ⑤评审 14——smoke page.reload():616 + sessionStorage 假身
  :678-682;⑥评审 7——getPosition 全量读 :83 起。零虚构。
- P1 六条合并:①评审 6 → 裁决 a(字节所有权保底前置);②评审 4
  → 裁决 b(事务契约+原生证明);③评审 1/3 → 裁决 c(失败分层:
  插入/替换/读/删各自语义);④评审 9 → 裁决 d(保底≠入架两段式);
  ⑤评审 12 → 裁决 e(per-docId 排序);⑥评审 13 → 裁决 k + 顺序
  重排(窄浏览器证明第 2 步)。P2/P3 七条:评审 2/5 → 裁决 g
  (提示并存+clearRecentIf);评审 7 → 裁决 f;评审 8 → 现状事实
  修正+裁决 l;评审 10 → 裁决 h;评审 11 → 裁决 i(Open Q1-Q4
  全落定:替换刷新 storedAt/title+页码/无 confirm/行内提示);
  评审 14 → 裁决 j(真机补关页重开+浏览器重启)。
- Top3 风险(评审原排序):①PDF.js buffer transfer 丢原字节
  ②乱序 save/delete 复活已删条目 ③原生存储证据不足——全部有
  对应裁决与钉测。
EOF
echo done && wc -l /home/youyd/projects/claudeProjects/LinguaLeaf/.scratch/pdf-shelf/spec.md

### 2026-11-07 维护者确认开工

- 「确认开工」:拍板三题不变,评审 14 发现合并后票面即定稿。
- Open 四题全部落定进裁决 i/c(替换刷新 storedAt、书架项 title+
  页码、删除无 confirm、存储失败轻量行内提示)。
- Status 翻 ready-for-agent,随立票 commit 入档。
