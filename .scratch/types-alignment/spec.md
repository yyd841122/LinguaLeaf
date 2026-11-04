# types-alignment:结构孪生类型攒批清扫

Status: ready-for-agent

来源:retro 2026-11-04(pdf-word-keyboard 会话)。CODING_STANDARDS.md
「Structural twins of an available named type sweep in a batch, not per
diff」的批清单家:评审按标准条向本票攒位点,本票一次语义恒同清扫,
不再逐票记不修。

## 已攒位点(清扫时现场取数定位,行号会漂)

1. apps/extension/src/reader/ReaderPage.tsx ~129-132 —
   `useState<{ word: string; point: { x: number; y: number } } | null>`;
   `WordClick` 自 74df19a 起已在该文件导入,可换
   `useState<WordClick | null>`。
2. apps/web/src/ReadingView.tsx ~70-72 — 逐块匿名 `statusOf` adapter
   (`(_word, index) => … wordStatuses[index] ?? null`);上票
   annotated-blocks-kernel 评审记档「toAnnotatedBlock 可提具名」所指,
   与 ext 侧同款 adapter 一并看是否值得提具名工厂。

## 开工触发

位点攒够 3 处,或任一票自然触及同文件时顺路收;单 commit 收官。

## 验收门

- 每位点换具名类型后 typecheck/lint 绿,语义恒同零行为变更
  (diff 里不得出现非类型行改动);
- 编排侧补跑全链 `npm run verify`(退出码为门)。
