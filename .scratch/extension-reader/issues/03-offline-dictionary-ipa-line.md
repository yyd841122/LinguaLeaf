# 03: 离线词典 + 音标行点亮

**What to build:** 打开 EPUB 后每个词正下方成对显示美式 IPA 音标行、随原文换行逐词对齐、一键开关。构建期从服务端词典数据烘焙离线资产（词形→美音 IPA、词元映射、高频词中译；规模量测后定裁剪，数据记票 Comments）；运行期以离线词典实现承载查词——词形优先、缺词留空槽、词元回退不冒充（标注来源可查询，为 04 卡片披露备好数据）；音标行走既有槽位真相源管线，扩展侧零改动复用。

**Blocked by:** 02

**Status:** done

依据：spec 离线词典与标注管线决策；GLOSSARY 音标行/离线词典/词元。

- [ ] 构建期烘焙脚本产出资产，规模与体积数据记入本票 ## Comments
- [ ] 阅读页全词音标行：词-音标逐词对齐、随换行
- [ ] 一键显示/隐藏音标行
- [ ] 词典查不到的词留空槽，排版不乱
- [ ] 词元回退的标注来源可从词典实现查询（供 04 卡片披露）
- [ ] 测试：fixture 词典过管线三路断言——词形命中/词元回退/缺词留空

## Comments

**收官(2026-10-28,实现会话)**:全仓 verify 绿(399 测试),真 Chromium 冒烟过。

- **烘焙量测(票内义务,实测 .data/dictionary.sqlite,1.3M ECDICT 词)**:产出
  `public/dictionary.json` **14.3MB**——ipa 124,987(美音 IPA 全量)、inflections
  167,108(全量)、entries 101,230(ECDICT 只烘 ipa 覆盖词:中译均长 ~21 字符,全量
  2.1MB 不需再裁;长尾词不进资产,槽位留空,英式音标不混入美式锁定阅读器)。
  烘焙命令 `npm run bake:dictionary --workspace @lingualeaf/extension`(可 --db/--out
  覆盖);资产不入库(本机构建),形状见 offline-dictionary.ts 的 BakedDictionary。
- **槽位真相源一码两宿**:buildIpaSlots/buildIpaLine/tokenizeWords 搬入
  import-core,lookup 改函数形;服务端留薄适配器保持 (dictionary, sentence) 签名,
  服务端测试零改写。首载一次性 fetch+parse 14.3MB(约 1–2s,个人使用可接受;
  首次冒烟 30s 超时即冷启动叠加解析,复跑秒过)。
- **渲染同构**:DOM/样式与 web 阅读页同一份(ipa-word/data-word/data-ipa 结构、
  共享 annotated-shared.css、::before 画音标不进选区);配对游走 segmentOriginal
  同源。jsdom 断言经 getAttribute 精确值(CODING_STANDARDS 的 jsdom 大小写坑)。
- **真 Chromium 几何冒烟**(CDP + 缓存二进制,dist 经 loopback http 供给):
  真词典应答(The→ˈðə)、空槽词(xqzzj)平排 lookup-word、开关 9→0→9 往返、
  词单元保留、零 pageerror。视觉终审(遮挡/换行观感)留给 07 人工验收一并看。
- **边角记录**:favicon 404 一条(无图标文件,07 整装时补);词条 disclose 数据
  (form|lemma)已在 resolveIpa 返回形状中,04 弹卡直接取用。
