# web-lemma-copy: web 弹卡的「原形」措辞与 GLOSSARY 词元词条相抵

Status: needs-triage

来源:extension-reader 票 07 双轴 review 的 Standards 轴(2026-10-28)。本 feature
往 GLOSSARY.md 写入词元(Lemma)词条时 _Avoid_ 列表明 retire「原形」;扩展弹卡已
改为「词元 run」(b38b78b 之后的修复),但 web 端弹卡是先于词条存在的旧措辞。

## 问题

apps/web/src/WordLookupPopup.tsx 两处用户可见文案用「原形」:
- `<span className="lookup-lemma">原形 {state.lookup.lemma}</span>`
- (web 端暂无披露行;extension 已有「音标为词元 X 的读音。」)

CODING_STANDARDS「User-facing copy speaks the glossary」:term just written down
is the term the UI renders。只改扩展不改 web = 两前端文案分叉。

## 开放决策(锁了才能进 ready-for-agent)

1. web 两处改「词元」,还是两前端一起抽共享文案常量(放 @lingualeaf/reading-model)?
2. 改 web 文案 = web 组件测试若干断言随之改写(wordLookup.test.tsx 的 原形 断言)。
