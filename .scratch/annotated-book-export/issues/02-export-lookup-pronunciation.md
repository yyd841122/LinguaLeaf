# 标注书文件：内嵌词义、点词查详情与发音

Status: ready-for-agent

Spec: `.scratch/annotated-book-export/spec.md`

Depends on: 01

## Scope

- 导出时收集本书去重词汇：键 = 与点词查详情同一规范化规则的词面形（大小写、弯引号归一），
  值 = 复用服务端 lookup 逻辑的结果或 null（查不到的词也内嵌 null）；只嵌本书句子块词汇，
  不整库内嵌、不直查 ECDICT 绕过现有规范化
- 文件内点词查详情：分词正则与 `apps/server/src/dict/ipa-line.ts` 保持一致
  （留注释注明与 ReadingView 副本同步的先例）；点词弹窗展示音标/词性/释义，
  查不到的词提示无结果
- 发音：Web Speech API `speechSynthesis`，失败静默不报错

## Acceptance

- 种子书导出后，jsdom 点词弹窗内容断言：命中词展示音标/词性/释义；
  词形变化词（复数/时态）命中词元词条；弯引号/大小写变体命中同一词条；生僻词提示无结果
- 内嵌词汇表键集合 == 本书句子块词汇的规范化去重集合（含查不到词的 null 值；不夹带整库）
- 词典查不到的词：音标行留空跳过（沿现状），不影响整句展示
