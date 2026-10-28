# 04: 点词弹卡 + 生词本四态

**What to build:** 点词→弹卡→改态→底色全链路：弹卡展示词元、美音 IPA、词性、中译（缺则留空）、发音按钮与生词本状态；未记录词元首查自动入学习、已有状态不覆盖、查不到不写任何数据；卡内显式改 学习中/已掌握/已忽略；学习中词保持查词底色、已掌握与已忽略弱化回普通文本，变化即时反映；在途写钉住属主令牌语义。UI 一律对内存 store 测试，chrome.storage 实现保持薄。

**Blocked by:** 03

**Status:** done

依据：ADR-0005（四态词元）、GLOSSARY 生词本/属主令牌/点词查详情；spec 存储 seam（唯一新 seam）。

- [ ] 点词弹卡五要素齐备，词元回退来源明确披露（不冒充词形读音）
- [ ] 首查自动 学习中；已有 学习中/已掌握/已忽略 不被查词覆盖；查不到的词零写入
- [ ] 卡内显式改三态即时生效，系统永不凭猜测迁移
- [ ] 学习中词保持查词底色；已掌握/已忽略弱化回普通文本
- [ ] 在途写 characterization：A→B→A 再入不误落、同词形（同词元）共享条目（先例：web 端弹窗在途写钉子）
- [ ] 存储接口含「查词即状态」语义；UI 不直调 chrome.*，全走注入 store

## Comments

**收官(2026-10-28,实现会话)**:全仓 verify 绿(413 测试),真 Chromium 弹卡冒烟过。

- **四决策落法**:存储 seam 单接口 `VocabularyStore{stateKey/lookup/setStatus/statesFor}`,
  查词即状态语义在 lookupFlow 单处承载(查不到零写入/未记录入 Learning/已有不覆盖),
  memory + chrome 两后端只是 get/getMany/put 三调用——行为面全测 memory,chrome 薄
  (spec 字面满足);弹卡 savingKeys 按 statusKey(词元)键控 + owner 令牌,web 端
  WordLookupPopup 同构移植(含 stale-put 修复后的形态);章节 tint 批量读 merge 落地
  (本地已有 key 不被覆盖——弹卡 patch 不会被先起的批量读回滚,自愈正确);词元读音
  披露行落在 IPA 之下(`音标为原形 X 的读音。`),ipaSource 由词典 lookup 返回。
- **真数据坑一枚**:真实词典里 woke 折叠到 wake(过去式词条),弹卡 原形 wake 正确;
  冒烟句选词时撞上,提醒 07 验收别拿 woke 当「无词元」例子。
- **测试基建**:deferred backend 按 state key 寻址 settle(对齐 web 端按 URL defer 的
  钉法;FIFO settle 会结算微任务次序碰巧先到的写,语义漂移——三钉子因此各排过一轮);
  settle 助手须异步让位微任务(put 在 lookup 起步一个微任务后才入队)。
- **jsdom 边角记录**:getByText 会双匹配词单元与弹卡头(弹卡头回显原文大小写),词级
  断言一律走 data-word + getAttribute 精确匹配(CODING_STANDARDS 的 jsdom 坑变体)。
- **真 Chromium 冒烟**(dist 需先 rebuild——改源后旧 dist 是静默失败源头,本冒烟
  首跑即栽在这):chrome.storage 以最小 stub 注入(扩展 origin 外无 chrome.*;真
  chromeBackend 由 07 人工 Edge 验收走),真词典答 原形 wake/woʊk/真 ECDICT 中译、
  首查自动 学习中、已掌握点击即 word-settled,零 pageerror。
