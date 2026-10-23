# 01 · 阅读对的契约面:目录与章内容过真 wire

Status: done

## Scope

- `apps/server/test/contract.test.ts` 新增 describe(ReadingPage 的两个
  fetchJson 调用):
  - 目录 `GET /api/books/:id`:钉 web 侧 TableOfContents 声明的形状——
    id / title / chapters 数组、条目恰好 {position, title, level}
    (toEqual 单条 + 总数),值级全列表归 api.test.ts 不重复;
  - 章内容 `GET /api/books/:id/chapters/:chapter`(样本书第 2 章):
    - sentence 臂:toEqual 键集 {position, kind, originalText,
      ipaSlots, ipaText, translationText},ipaSlots 是数组
      (expect.any(Array)),translationText 为 null(无 translator 路径);
    - code / raw 臂:toEqual 恰好三键 {position, kind, originalText},
      无任何注释键;
    - heading-only 章(第 3 章)blocks 为 [];
    - 越界章 `/chapters/99` 经真客户端 404,body {error: "chapter not
      found"}。
  - image 臂:buildEpub 一章小书(段 + `<img alt>` + 段)经真上传路径
    (uploadBook 泛化出 bytes 变体)→ waitForShelfBook → 章内容的
    image 块 toEqual {position, kind: "image", originalText: alt 文本}。
- 只动 contract.test.ts(+ 必要的夹具 import);api.test.ts /
  reading.test.tsx / 服务端源码零改动。

## Gate

`npm run typecheck && npm test && npm run lint` 绿(看退出码)。契约套件
既有断言零删改;评审基线 = 本票第一个实现 commit 之前的 HEAD。

## Comments
Done in 7a76d37. contract.test.ts gained the reading page's describe: the
TOC pinned at the web type's key set (id/title, one chapters entry at
exactly {position, title, level}), chapter blocks as the Block union —
sentence arm with a decoded ipaSlots array and null translationText, the
interlude chapter pinning code and raw at exactly three keys, the image
placeholder (alt text) from a real EPUB upload through uploadBookBytes,
heading-only empty blocks, and the out-of-range 404 through the client.
api.test.ts / reading.test.tsx untouched; suite 28 tests green (254 total,
exit 0). One mid-flight fix: the passthrough pins first sat on chapter 2 —
all-sentence; they moved to the interlude (chapter 4), where code and raw
actually live.
