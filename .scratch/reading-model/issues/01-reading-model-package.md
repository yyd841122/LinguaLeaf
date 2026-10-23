# 01 · reading-model 包落地:五条规则 + WordLookup 类型单源

Status: ready-for-agent

## Scope

1. packages/reading-model 新包:零依赖、浏览器导向;"prepare" 即构建
   dist;exports 指向 dist;src 八模块(index、word-pattern、lookup-fold、
   word-lookup、popup-anchor、speak、book-filename、sentence-segments)。
2. server 侧切换:dictionary.ts 删 normalizeToken/normalizeLookupToken/
   WordLookup 本体、改 re-export(内部调用改 import);ipa-line.ts 的
   WORD_PATTERN 改从包 import(tokenizeWords/buildIpaSlots 留守);
   annotated-book.ts 的 renderSentenceBlock/collectVocabulary 改吃
   segmentOriginal + 包内 WORD_PATTERN/fold;annotatedBookFilename 迁出、
   annotated-book re-export(books-router 不动);FILE_SCRIPT 内三份
   副本暂不动(票 02 收编)。
3. web 侧切换:ReadingView 的 WORD_PATTERN 副本删除,SentenceBlockView
   一次 segmentOriginal、WordSegments 吃 segments(顺带消掉现存的双次
   matchAll);wordLookup.ts 的 WordLookup 与 speakWord 改 re-export;
   WordLookupPopup 的常量 + anchoredStyle 改用包 anchorPopup;download.ts
   删 sanitizeFilename、用包 annotatedBookFilename(filenameFromDisposition
   留守)。
4. 构建接线:根 workspaces 加 packages/*;typecheck/build 显式排序
   (包先于 server);根 pretest 先构建包 dist;eslint browser globals
   块纳入包;根 vitest projects 加包;dist 进 .gitignore。
5. 包单测:fold 变体、pattern 形状、segments 配对/回退、clamp 边界、
   文件名变体、speak 存根(jsdom)。

## Gate

`npm run typecheck && npm test && npm run lint` 绿;web/server 既有套件
断言零改动通过(行为信封——本票不改变任何线上行为)。

## Comments
