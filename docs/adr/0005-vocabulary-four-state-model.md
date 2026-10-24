---
status: accepted
---

# 生词本采用四态词元状态模型

点词查详情（GLOSSARY.md）已在阅读路径上，但查过就忘——词没有记忆。引入生词本：状态按
**词元（lemma）**记录，四态 **New / Learning / Known / Ignored**——Ignored 语义是
「不纳入学习」（功能词、专名），与 Known「已掌握」严格分开，否则功能词污染掌握统计。
迁移规则只有一条是自动的：首次主动查词该词元 New→Learning（查词本身就是「不会」的信号，
省掉每次查词后的手动操作）；Known/Ignored 及一切反向迁移必须用户显式操作，系统永不凭
点击次数猜测掌握度。Known/Ignored 的词在阅读中不再强调，视觉弱化回普通文本——让会的词
从辅助里「消失」。模型整体承接 graded-reader 仓库 ADR-012（Lute v3 谱系）的设计与论证，
实现票见 `.scratch/vocabulary-states/`。

## Considered Options

- 三态（Ignored 并入 Known）：功能词污染「已掌握」统计，否决
- 两态（Known/未掌握）：表达不出「正在学」的过程态，否决
- 数字等级（LingQ 1-5）：表达力更强但交互与认知成本高，MVP 不需要，否决
