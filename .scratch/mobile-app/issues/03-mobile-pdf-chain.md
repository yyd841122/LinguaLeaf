# 03 PDF 链:断网真机读 PDF 全链路
Status: ready-for-human(2026-11-14 实现收官:根 verify EXIT=0、Claude 子代理双轴评审无 blocker/concern 修笔 4 记档 3;真机三项人验待做,见 Comments 与用户操作项;Codex 终审 11-15 补跑)
Blocked by: 02

## 目标

PDF 阅读链路在真机启用:导入文本层完好的 PDF → pdfjs 坐标叠加音标 → 查词/生词/进度/书签/笔记与 EPUB 同权。

## 范围

- pdfjs-dist(^4.10.38)worker 在 WebView 的路径/打包处理
- pdf 三 store(pdf-position / pdf-notes / pdf-fingerprint)+ idb-bytes-store 真机启用与验证(02 已随迁)
- PDF 导入入口与书架接入(02 已备形状)
- 已知边界:扫描件不支持(既有导入边界);PDF 无句子块/章节 → 无按需翻译、听书按行序(spec Out of Scope / ADR-0008)

## 验收门

- 根 verify EXIT=0
- 真机【人验】:导入文本层完好 PDF → 坐标叠加音标 + 点词查详情 + 进度/书签/笔记;飞行模式重复;杀进程重开仍在

## 用户操作项(人做)

- 准备一本文本层完好的 PDF 传入手机
- 飞行模式与杀进程重开验证

## Comments

### 2026-11-11 领票前注(编排会话留档,clear 前固化)

验收门含「书签」,但手机端书签现为空集(票 10 needs-triage,扩展基座无可
搬)——与 05 领票前注同源的顺序茬,05 那边已留档、03 这边此前漏记。领票前需
先拍板票 10,二选一:(a) 10 提前排;(b) 03/05 照写、书签项后补,10 排 06 前。
后续拍板与选择记回本节。

**拍板回写(2026-11-11)**:维护者选 **(a) 提前**,票 10 已翻
ready-for-agent(Lane B)——EPUB 书签先行落地,本票门内「书签」届时原样可
过:PDF 接入以 10 的 bookmark-store 扩 page 目标(见 10 票面范围节),门文本
不改。顺序茬解除。

### 2026-11-14 领票(Lane A)

**Lane 拍板**:Codex 额度 11-15 10:55 恢复,今日不可用——按 10/05 先例翻
**Lane A**(Claude 实现 + Claude 子代理双轴评审兜底);独立终审进 11-15
挂账(与 02/10/05 三笔同批)。

**票面事实核对(现场取数,无漂移)**:
- pdfjs-dist ^4.10.38(实装 4.10.38,hoisted)✓
- pdf 三 store + idb-bytes-store 已随迁(02),测试随迁齐 ✓
- 导入入口与书架形状已备:ReaderPage handleFile `.pdf` 分支、acceptPdf、
  PdfShelf/usePdfShelf 全接线(02 遗留「不启用」仅指验收未验,无开关)✓
- detectScanned 扫描件边界在 pdf.ts ✓;PDF 面无翻译接线(设计)✓
- bookmark-store 已落地(10),page 目标扩展归本票 ✓

**实现期拍板三件**:
1. **pdfjs 切 legacy build**:pdfjs 4.10 标准版主/worker 双线程依赖
   `Promise.withResolvers`(Chromium 119+,2023-11);legacy build 自带
   垫片,Android WebView 基线显著放宽容错。Capacitor 8
   WebViewLocalServer.getMimeType 已显式 `.mjs → application/javascript`,
   模块 worker MIME 校验无虞(pdf.ts:12 `new Worker(url,{type:"module"})`
   现场核对)。pdf.ts 两行导入 + pdfRendering.test mock 目标同步。
2. **bookmark-store 扩 page 目标**(10 票面既定路线):`BookmarkTarget`
   成判别联合 `{chapter,block} | {page}`;单书单一形状(EPUB=doc:<title>,
   PDF=指纹 id),排序与幂等按形状分支;备份导出过滤 page 行——与 05
   记档「PDF 资产本票不含,版本门留扩展位」同姿势,版本 bump 归 follow-up。
3. **PDF 书签面镜像 EpubReader**(10 形状):头部「书签」钮 → veil+card
   面板;行 = 第 N 页 + 落签时刻;plant 幂等按页;jump = onPage 翻页。

**用户操作项提醒(收官人验时勿漏)**:准备文本层完好 PDF 传手机;飞行
模式重复;杀进程重开仍在——票面「用户操作项」三件。

### 2026-11-14 实现收官(Lane A)

**落地面**(基线 = 本票首个实现 commit 之前的 HEAD):
1. **pdfjs 切 legacy build**(pdf.ts):设备 WebView 实测 Chromium
   97.0.4692.98(dumpsys webviewupdate 现场取证)——标准版主/worker
   依赖 Promise.withResolvers(Chromium 119+),标准版在此机必挂;
   legacy build 自带 withResolvers 与 structuredClone(98+)垫片
   (core-js 机制,现场 grep 证实)。Capacitor 8 WebViewLocalServer 对
   .mjs 显式 application/javascript,模块 worker MIME 校验无虞。
   dist 产物核对:worker 以哈希资产落包根,标准版特征串已不在包内。
2. **bookmark-store 扩 page 目标**(按领票拍板 2):判别联合
   `{chapter,block} | {page}`,sameTarget 分形幂等、byReadingOrder
   分形排序,两孪生共享 plantRow;EPUB 接口形状零变(票 10 套件复绿)。
3. **PDF 书签面**(按领票拍板 3):PdfReader 头部「书签」钮 →
   veil+card 面板;plant 幂等按页、列表页序、jump 走翻页通道、删除;
   formatPlantedAt 抽 bookmark-view.ts 两面共享一事实。
4. **备份过滤 page 行**:导出双滤(assets + books),与 05 记档姿势
   一致;版本门扩展位归 stub 票 12。
5. **拍板补记(评审追问落档)**:onPage/onScale 清锚定弹窗——EPUB
   goChapter 同法(EpubReader.tsx setLookup(null) 实证),属门内「点词
   查详情」链的启用件;书签钮开面板亦清(EPUB 孪生同位行为)。

**验证**:根 `npm run verify` EXIT=0(修笔后 caller 复跑,104 文件,
**1147 passed | 3 skipped**——计数照最新实跑转抄)。

**双轴评审**(Codex 额度未复,按 Lane 惯例 Claude 子代理兜底,终审挂账
11-15):Standards 轴 25 条标准查过干净 + 变异心证抽查全有红;Spec 轴
七问全过。**无 blocker/concern**。修笔 4 件:①PDF 书签钮清弹窗;②翻页
/缩放清弹窗加 pin(pdfReaderBookmarks 第 6 案);③本套件 fetch stub
收紧为 dictionary-only 未匹配即抛;④混合形 comparator 归 0 pin(不变
式原纯散文)。记档 3 件:setLookup 拍板(上 5);票 10 时敏抖动再现
一次(单跑复绿,签名同 2026-11-13 pre-commit flake,已回记票 10);
ReaderPage:257 结构孪生入 types-alignment 攒批位点 3(攒够 3 处,
触发线达成,清扫另启)。

**真机准备(已就绪)**:assembleDebug → `adb install -r` Success,修复
版(含评审修笔)已装机。冷启冒烟未做——前台属主在用第三方应用,按
adb 纪律停手,并入门内人验时序。

**人验清单(三件,勿漏)**:
1. 准备文本层完好 PDF 传入手机 → 导入 → 坐标叠加音标 + 点词查详情 +
   进度/书签/笔记(书签:打签/列表/跳回/删除)
2. 飞行模式重复全链
3. 杀进程重开仍在(进度/书签/笔记/书架)

### 2026-11-14 人验 round 1 返修记档 — 笔钉风暴(视觉行聚类)

**现象(真机,茶花女.pdf)**:笔记 ✎ 每页数百枚"无数个",词叠加同碎,
干扰阅读。

**根因(现场取数)**:pdf-lines 的 eligiblePdfLines 以 TextItem 为行
单位;此书为逐字形 item 流——第 1 页 922 个 text item / 仅 16 个视觉
行(单行最多 83 item),一 item 一笔即笔钉风暴。空格由 whitespace
item 承载(203 个),按 x 排序逐字拼接即还原真文本,无需间隙启发式。

**修笔(仅 mobile;扩展同源代码按 D12 不动)**:
- pdf-lines.ts 重写为视觉行契约:基线容差聚类(0.25×fontPx)→ x 排序
  → 逐字拼接 → 一行一 index;行序按基线自上而下,流序不再可信
- pdf.ts 渲染循环改合并行几何:origin=最左 x、end=最右 item 右缘、
  fontPx=行内最大;单词 span 与笔的比例布局退到行粒度——单 item 行
  数学退化等价(pdfRendering 套件零改动全绿即证)
- pdfLines.test 重写到新契约 4 案:逐字形流合并/容差分裂/自上而下
  行序/旧语义存活(NFC、\r\n、标点行跳过、几何引用保留)

**验证**:真书复算 3 页笔数 97(原 ~3000+),第 1 页 15 笔(原 922),
218 词/页叠加;根 verify EXIT=0(104 文件,**1150 passed | 3 skipped**)。

**已知边界记档**:行 index 语义由 item 序改视觉行序——旧笔记锚
(本机尚无存量)由既有 drift 守卫(行文本不符保留不回挂)自然兜住。
"ChapterI" 类源数据缺空格是 PDF 文本层保真度,非本链缺陷。

### 2026-11-14 人验 round 2 返修记档 — 丢空格词熔接(间隙补空格)

**现象(真机,同一本)**:部分词点词识别错——几个单词熔在一起。

**根因(现场取数)**:此书生成器丢了部分空格字形——前 20 页字母接缝
30,618 处中 753 处间隙 0.10~0.60(词|词熔接,如 "ChapterI"、"r…I");
正文另一类空格由 whitespace item 承载(19,668 个)完好。是 PDF 文本层
保真度问题,但间隙信号干净可补。

**阈值取数(0.02 分箱,20 页)**:字距质量块 ≤0.08(拖尾 0.10~0.14 共
26 处),空格质量块 0.16(506)+0.18(213)——分布谷在 0.15。取
MISSING_SPACE_GAP=0.15:字母对字母且间隙 ≥0.15 字宽补一空格;宁漏 26
处字距拖尾、不错拆真词。

**修笔**:pdf-lines join 改「逐字拼接 + 间隙补空格」;补 pdfLines
两案(0.18 间隙补空格 "Chapter I"/0.06 字距不拆/标点边界不插)。

**验证**:根 verify EXIT=0(104 文件,**1152 passed | 3 skipped**);
真书 3 页补回 101 空格,行/笔数不变(15/41/41)。新 APK 已装机。

### 2026-11-14 人验 round 3 返修记档 — PDF 打签无页上标志

**现象(真机)**:PDF 打书签后页上无任何标志——EPUB 面有紫条+飘带
(票 10 终版),同权缺角。

**修笔**:页粒度镜像同款视觉——PdfPage 增 marked prop(由
bookmarkRows 派生,plant/delete 面板操作即现/即隐,零重挂),stage 内
渲染 .pdf-bookmark-mark(左缘 3px 紫条 #6a4fa3 + 右上飘带,同色同形;
pointer-events:none / aria-hidden,装饰不截交互)。测试钉四面:打签现
标志、未签页无、跳回现、删除消。

**验证**:根 verify EXIT=0(104 文件,1152 passed | 3 skipped);APK
重装 Success。同轮机检顺带实证:冷启 1140ms、书架恢复、开书回原位
(进度恢复)、真书音标叠加与笔钮(dump 取证)。

### 2026-11-14 人验 round 4 返修记档 — 书签升级行级(页粒度失义)

**现象(维护者拍板)**:书签钉在页上,无法标记具体读到的段落——「失去
书签的意义了」。

**设计升级(与维护者实时拍板同轮)**:书签目标 `{page}` →
`{page, line, text}`——EPUB 的单位是段落块,PDF 的单位是视觉行,行
级即同权:

- **store**:PdfBookmarkRow 增 line(页面视觉行 index,渲染稳定)+
  text(落签行文本摘要,面板免开书可读);幂等按 (page,line);round 3
  旧页级行读归一(line 0 / 空 text = 页顶,正是旧标志所挂位置)
- **plant 双路**:①「在当前位置打书签」= 最顶可见行(EPUB
  topmost-visible 规则移植到行粒度,经 PdfPage handle 读行 DOM 几何);
  ②**长按任意单词** = 钉在那一句(500ms 拍,移动 >10px 取消,吞掉
  松手后的点词 click,contextmenu 抑制 + stage user-select:none)
- **标志**:紫条 + 飘带从页级改行带级(top/height 来自渲染行几何
  PdfLineGeo,面板操作即现即隐)
- **跳回**:翻页(异页时)+ ready 后该行 scrollIntoView 居中(EPUB
  同形 armed-jump);面板行显示「第 N 页 · 行文本摘要」+ 落签时刻
- **pdf.ts**:renderPdfPage 返回增 lines 行几何(单 item 行数学不变)

**验证**:根 verify EXIT=0(104 文件,**1154 passed | 3 skipped**);
新案:长按打签+吞点词、旧行归一、行级断言四面;APK 重装 Success。

### 2026-11-14 人验 round 5 返修记档 — 缩放改适宽语义(满屏免平移)

**现象(维护者拍板)**:PDF 无法满屏,读边上内容要手动左右移动——
scale 1 是 PDF 原始单位(612px)而手机视口 ~400px,连 75%(459px)都
超宽,每档都要平移。

**修笔**:缩放语义从「PDF 原始倍率」改为「**适宽倍率**」——100% =
撑满 reader 内容宽(clientWidth − 左右 padding),75%/150% 为适宽的
相对倍率(150% 恢复放大平移能力);渲染时按当前页 base 宽自动算
fit(pdf.ts 内 canvas.closest("main") 取容器,jsdom 无 main 回落
fit=1,契约测试零改动);行几何的 px 换算随 effective scale;缩放钮
中档标签改「适宽」。页宽不一致的文档逐页各自适宽。旧存档 scale 1
(默认)重开即适宽,1.5 重开为放大态,语义自洽。

**验证**:根 verify EXIT=0(104 文件,1154 passed | 3 skipped);
pdfReaderNotes 一处「100%」钮断言随标签更新。APK 重装 Success。
已知边界:旋转屏幕后到下次重渲染才重新适宽。

### 2026-11-15 人验 round 6 返修记档 — 音标压住正文(行距自适应挂位)

**现象(真机,适宽后)**:音标大小压住原文字,无法阅读——适宽把整页
缩到 ~0.6×,音标仍挂 fontPx+2:固定版面的下一行 band 就是「词下方」,
白底 0.85 音标片直接糊住下一行字形。

**根因**:「词正下方挂音标」是 EPUB 重排版面的假设;PDF 版面固定,
行距没有给音标留位,挂位必须按实测行距自适应。

**修笔**:渲染改两段式——先全量测每行几何,再建 span;每行按「本行
band 底到下一行 band 顶的实测间隙」二选一:
- 间隙 ≥ 0.62×fontPx+3 → 挂下方(原桌面形态不变)
- 不足 → `.pdf-ipa-tight`:0.5em 半透明片(白 0.45)压在**自己词**的
  上半 band,永不触碰邻行
页末行恒有余量。pdfRendering 新案钉住:紧排行 2 词带 tight 片、
top=0.12×fontPx、宽继行保持挂下。

**验证**:根 verify EXIT=0(104 文件,**1155 passed | 3 skipped**);
APK 重装 Success。已知边界:tight 片仍部分遮自己词的上半字形——
固定版面的物理代价,放大(150%)后多数行会回到挂下形态。

### 2026-11-15 人验 round 7 返修记档 — PDF 重排阅读态(画布满屏形态到头)

**现象(真机截图取证)**:tight 片已生效但整页 ~7px 原字 + 满页半透明
片 = 紫色糊墙,无法阅读。固定版面整页塞手机宽,字必然这么小——
画布满屏形态对小说类 PDF 无解,样式修不完。

**设计升级(维护者拍板方向)**:PDF 加**重排阅读态**——页面视觉行
(round 2 修好的阅读序)直接渲染为内核 EPUB 同形 DOM(ipa-word 音标
带、sentence-block,样式经 annotated-shared.css 白得),字号舒适、
纵向滚动、免平移。画布态保留为「原版」(坐标叠加门形态,看版式/图表
用),头部「重排/原版」一键切换,**选择随进度持久化**(pdf-position
增可选 view 字段,缺省 canvas)。

- **共享锚**:查词(WordLookupPopup 同缝)、笔记(page/lineIndex/
  lineText 同键)、书签(page/line 同行级锚)两面互认;长按打签、
  armed-jump、书签面板全部两面共用;行标志 = EPUB block-marked 原类
- **词形**:ipa-word(ipa 带)/lookup-word(无词典词),showIpa 开关
  语义同 EPUB;行文本段 = round 2 的逐字拼接 + 间隙补空格产物
- **测试**:新 pdfReflow 5 案(词形/长按打签+标志块/行笔记同锚/
  切换持久化+翻回画布/面板跳回);pdfPositionStore 1 案(view 随
  位置持久、旧行缺 view);加固 pdfReaderBookmarks 长按案的 ready 门
  (笔钮 enabled = lineGeo 落地,全量负载竞态第 3 例,签名同前)

**验证**:根 verify EXIT=0(105 文件,**1161 passed | 3 skipped**);
APK 重装 Success。已知边界:重排态丢失原版面(图/公式不显示)——
切「原版」看;扫描件本就被导入边界拒。

### 2026-11-15 人验 round 8 返修记档 — 重排态固定壳(head 不钉)

**现象(真机,机检复现)**:重排态上滑两三屏后头部整条滚出视口,书签
钮够不着——position:sticky 在该 WebView 深滚动下不可靠(机检 swipe×2
+ 截图复现;浅滚可见钉住、深滚失效,引擎行为非样式错误)。

**修笔**:重排态弃 sticky,换确定性固定壳——main 加 reader-reflow
修饰类(100vh flex column):头部 static 钉顶、pdf-reflow 行列表为唯一
滚动区(flex:1 + overflow-y:auto)、翻页器钉底(**翻页钮随壳常驻,
顺带解决深滚后翻页够不着**);画布态保持共享 sticky 布局不动。

**验证**:根 verify EXIT=0(105 文件,1161 passed | 3 skipped);机检
闭环:冷启→书架→开书**直接恢复重排态**(view 持久化实证)→深滑三屏
截图:头部/翻页器常驻、行列表边界裁切正常、书签飘带在位。APK 重装
Success。

### 2026-11-15 人验 round 9 返修记档 — 壳高钉 ICB + 横滑禁用 + 按钮签行级

**现象(真机机检 + CDP 取证)**:①翻页后壳又被上推 ~90px;②重排态可
左右平移;③「在当前位置打书签」钉不到段——按钮走 stage 句柄,重排态
句柄为空,恒落兜底 line 0(页顶)。

**根因(CDP 量尺)**:WebView 布局视口(ICB)748px ≠ innerHeight 814px
——`100vh` 随 innerHeight 走,差值 66px 恰成 body 可滚余量,翻页链路
一推整壳上移;旧面板第 4 页裸行即③的历史产物。

**修笔**:①壳高 JS 钉 `documentElement.clientHeight`(--shell-h,
resize 跟随)——body 永零滚动余量,机检量尺 mainRectTop=0/docScroll=0
/mainH=docClientH=748 翻页深滑后恒成立;②`.pdf-reflow` overflow-x
hidden(换行文本本无横向溢出,防 IPA nowrap 撕开缝);③重排面接共享
ReaderFaceHandle(两 face 同形:invalidate + topmostVisibleLine),
按钮打签两面都钉**当前视线行**。

**验证**:根 verify EXIT=0(105 文件,1161 passed | 3 skipped);机检
闭环:翻页+深滑三屏量尺恒成立、CDP 面板读数「第 8 页 · credit,
How wi」(行级+摘要)。APK 重装 Success。面板中「第 4 页」裸行为
round 7 前历史页级签(读归一 line 0),非缺陷。
