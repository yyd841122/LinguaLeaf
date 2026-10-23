# 02 · file front entry:FILE_SCRIPT 从字符串字面量升格为真源码

Status: ready-for-agent

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
