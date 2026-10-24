# 生词本:四态词元状态(ADR 0005 的实现)

来源:旧仓库复盘(2026-10-24)。graded-reader(docs-only 仓库)的 ADR-012 已把状态模型
磨透,PRD §5.4 的浮层状态操作对应其 ADR-009;LinguaLeaf 的点词查详情已存在,缺的是
「词的记忆」。决策记录在 `docs/adr/0005-vocabulary-four-state-model.md`,本 spec 只管
落地形状。

## 领域规则(引用 ADR 0005,此处不重复论证)

- 状态按词元(lemma)记录,四态 New / Learning / Known / Ignored。
- 唯一自动迁移:首次主动查词 New→Learning。其余一律显式操作。
- Known/Ignored 的词在原文行中视觉弱化为普通文本(不再是查词高亮目标?——是:仍可点开
  弹窗,但去 hover 底色)。

## 落地形状(方向,非合同;细节由实现票的 grilling 收口)

- 服务端:词元状态表(word, status, timestamp),lookup-router 命中时自动写
  New→Learning;弹窗增删状态的端点。
- web:WordLookupPopup 加状态操作(GR ADR-009 的浮层操作);ReadingView 对
  Known/Ignored 词去 hover 底色。
- 导出文件:v1 不带生词本状态(导出是快照,状态是活的用户数据)——在票里显式决定,
  不做静默省略。

## 门禁

- 实现时把「生词本 (Vocabulary)」「Learning / Known / Ignored」词条写入 GLOSSARY.md
  (New 是否成词条由实现时判断)——**人机共检,勿跳**。
- `npm run verify` 全绿(看退出码,不看 tail)。
