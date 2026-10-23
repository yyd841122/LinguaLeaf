# 02 · file front entry:FILE_SCRIPT 从字符串字面量升格为真源码

Status: done

## Scope

1. packages/reading-model/src/export-front.ts:FILE_SCRIPT 的 TS port
   ——开关 + localStorage 卫兵、词表 JSON 解析、弹层接线、外点/Escape
   关闭、发音按钮;fold/anchor/speak 从包 import;禁 async/generator、
   不走 for-of(es5 target)。
2. apps/server/scripts/build-file-script.mjs:esbuild bundle → IIFE →
   es5;`</script` 序列卫兵;JSON.stringify 写入生成物;--check 模式
   (与提交产物逐字节比对,漂移退出码 1 并指路)。
3. apps/server/src/export/file-script.generated.ts:提交入库,头部注明
   生成器与来源;annotated-book.ts 改 import、删手写 FILE_SCRIPT;弹层
   CSS 从包常量插值(产出值不变:18rem / 16rem / calc(100vw - 1rem))。
4. apps/server/test/file-script-fresh.test.ts:execFileSync 跑 --check。
5. server devDep esbuild + "build:file-script" 脚本;根 build 链插入
   build:file-script(包构建之后、typecheck 之前);生成物进
   .prettierignore 与 eslint ignores。
6. 负向验证:手改 export-front.ts 不重新生成 → --check 红且报文指路;
   重新生成后转绿(记入 Comments)。

## Gate

`npm run typecheck && npm test && npm run lint` 绿;export.test.ts 断言
零改动通过(JSDOM 行为信封);新鲜度门禁绿;收尾 `npm run verify` 全绿。

## Comments

## Comments

Done. Gate held: typecheck / test / lint green, `export.test.ts` passed
with zero assertion changes (the JSDOM behavior envelope — popup, toggles,
speech, misses, self-contained red line all run the committed generated
file through the real export endpoint), freshness gate green in both
invocation styles, `npm run verify` green end-to-end. Negative
verification recorded: a probe changing a string literal in
export-front.ts made `--check` exit 1 with the regenerate command; the
revert made it exit 0. (A probe that only adds a comment does NOT trip
the gate — esbuild strips comments, so the compiled bytes are unchanged;
that is correct gate behavior, the freshness contract is over compiled
output.)

Three deviations from the ticket as written, all caught by gates:

1. es5 → **es2017** (spec decision 3 updated): esbuild cannot lower
   const/arrows/destructuring to es5, and the shared package modules are
   modern-style; the file's CSS already requires flexbox-era browsers, so
   the es5 conservatism was nominal. Optional chaining/nullish still
   lower; async/generators stay banned in the entry.
2. `absWorkingDir` pinned in the build script: esbuild writes source-path
   comments relative to the invocation cwd, so `npm run --workspace`
   (cwd apps/server) and a manual root run produced different bytes — the
   gate flapped until the working dir was pinned.
3. Catch guards use the optional-catch-binding form (`catch {`), matching
   download.ts's existing style; tseslint v8 flags unused bindings, and
   esbuild lowers the form for es2017.

Also: the popup clamp narrowing needed a guard-then-rebind (`const
popup: HTMLElement = popupNode`) — narrowing does not flow into hoisted
function declarations. The popup box CSS now interpolates from the
reading model's constants; a render confirms byte-identical output
(18rem / calc(100vw - 1rem) / 16rem).
