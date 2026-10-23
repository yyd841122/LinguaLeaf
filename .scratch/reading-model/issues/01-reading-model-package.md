# 01 · reading-model 包落地:五条规则 + WordLookup 类型单源

Status: done

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

## Comments

Done. Gate held as written: `npm run typecheck && npm test && npm run
lint` green, and every pre-existing web/server suite passed with zero
assertion changes — the envelope held (206 old tests untouched, +24
package unit tests). `npm run verify` also green end-to-end; both build
outputs resolve the package at runtime (web bundle carries the shared
speak code, server build imports through the workspace link).

Two shape corrections the first gate run forced (both caught by tests,
none by hand-waving):

1. The filename rule is NOT one function: the server appends `.html` to
   a title, the web client must not (header names arrive suffixed). The
   honest split is `cleanFilenameBase` (the one cleaning pass, both ends)
   + `annotatedBookFilename` (the server's suffixed attachment name,
   which doubles as the web's empty-header fallback via
   `annotatedBookFilename(null)`). A first merge that appended everywhere
   produced `X.html.html` — the bookshelf + contract download tests
   caught it before any human would have.
2. Fold/corner test expectations: `normalizeLookupToken("'book',")` keeps
   its leading apostrophe (allowed class), and a corner click anchors at
   top = vertical offset (14), not the margin — both pinned in package
   tests now.

Also: dist is eslint-ignored (build output carried `window` into
no-undef), and `pretypecheck`/`pretest` build the package so server
typecheck/tests always see a fresh dist. Editing package src means the
next `npm run typecheck`/`npm test`/`npm run build` rebuilds it; bare
`npm run dev` reads the last-built dist (acceptable — noted for retro).
