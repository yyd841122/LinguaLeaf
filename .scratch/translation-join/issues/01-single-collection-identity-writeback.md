# 01 · 收集一次句子块引用,回填走对象同一性

Status: done

## Scope

- `apps/server/src/import/import-task.ts`:删除收集与回填的两次独立过滤——
  - 一次 `sentenceBlocksByChapter = chapterBlocks.map(blocks =>
    blocks.filter(kind === "sentence"))`;
  - `sentenceCount` 由这组引用派生;
  - `translateChapters` 的输入在调用点 `map(block.text)`;
  - 回填 forEach 这组引用就地填 `block.translation`(不再重新 filter、
    不再手数 sentenceIndex);
  - 注释写明 join 靠对象同一性(引用 .scratch/translation-join/)。
- 其余零改动:进度回调、persist 调用、pipeline.ts、translate/。

## Gate

`npm run typecheck && npm test && npm run lint` 绿(看退出码)。现有测试
零改动全绿 = 重构安全的包络。评审基线 = 本票第一个实现 commit 之前的 HEAD。

## Comments

Done in dce8756. The two filtered traversals collapsed into one collected
reference set (sentenceBlocksByChapter); the translator input is mapped from
it at the call site, and the write-back mutates those objects, so the join
into chapterBlocks / persistBook is object identity. Progress callback,
persist call, pipeline.ts, and translate/ untouched. Envelope held: the full
suite ran green with zero test edits (231 tests, exit 0).
