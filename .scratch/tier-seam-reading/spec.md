# tier-seam-reading:阅读对的契约面——缝上最后两个裸奔的调用

来源:architecture-review-20261022 候选 3(Strong · in-process)的收口轮。
候选 3 的主体(tier-seam contract suite,8921fa4)已落地并经 wire / registry
两轮扩过:上传、书架、删除、导出、查词、进度都有真 fetch × 真 app 的钉。
本轮收的是对现状盘点出的剩余缺口:ReadingPage 的两个主取数——目录
`GET /api/books/:id` 与章内容 `GET /api/books/:id/chapters/:chapter`——
是缝上仅存的「两侧各测各的假设」调用:api.test.ts 用 supertest 钉了服务端
值,reading.test.tsx 用手搭 `Block[]` 钉了组件渲染,中间没有任何测试让
web 的 fetchJson 带着真实响应形状跑过这两条路由。同缝还有两个更小的洞:
409-before-ready 只在 progress 路由钉过(TOC / 章内容 / 导出同守
respondIfNotReady);fetchWordLookup「服务器打嗝必须抛错、不得伪装成
未收录」只是 wordLookup.ts 里的文档句,没有可执行钉(404→null 有钉,
500 抛错没有)。

## 问题

ReadingPage 的 TableOfContents / ChapterContent / Block 三个类型是缝的
web 侧声明:sentence 块带 ipaSlots(必须是解码后的数组,不是 JSON 串)、
ipaText、translationText(可空);非句块只带 {position, kind,
originalText}。server 端 decodeBlock 恰好按这个联合产出,但两侧只是各自
被测——mock 再漂一次(书架 204 那次的前科)依然是人工验收兜底。同样,
未就绪书的 409、词典断连时的 500,web 侧的分支(「这一章加载失败」、
「打嗝不得伪装成未收录」)都没有真 wire 证明。

## 方案

扩既有 contract.test.ts,不建新机制:

- 目录与章内容经 fetchJson 打真路由,钉 web 类型声明了的形状(键集、
  判别 kind、可空性、ipaSlots 是数组);值级形状仍归 api.test.ts;
- image 臂经 buildEpub 真上传到达——契约套件的上传路径也第一次过 EPUB;
- 409 家族:既有 gated-import 夹具一次盖住 TOC / 章内容 / 导出
  (downloadAttachment 的 catchable ApiError;409 走 !ok 抛错路径,
  不触 DOM 半边,无需浏览器 stub);
- 500 打嗝:关掉夹具词典制造真 500,fetchWordLookup 必须抛
  (ApiError 500),不得返回 null;错误中间件的 console.error 就地 spy。

## 决策

1. **断言钉形状不钉值**。api.test.ts 已 toEqual 全部块数组;契约测试的
   增量是「web 类型声明在真 wire 上成立」——toEqual 键集、判别 kind、
   level / translationText 的可空、ipaSlots 的数组性。重复断言 IPA 具体
   值只会造第二处漂移点。
2. **不为 image 臂手造 markdown 伪夹具**。image 从 EPUB 真路径来
   (buildEpub 已有确定性夹具):一本一章小书、一段夹一张图,走真上传。
   非句块 decodeBlock 是一条 else 臂,code / raw 已由样本书钉住形状,
   image 臂补的是 kind 值本身。
3. **409 钉家族不钉孤例**。既有 409 测试只钉了 progress 一条路由,而它
   的名字写的是 "reading routes"——在同一个门上把 TOC / 章内容 / 导出
   加盖进去,让名字与断言一致;progress 的既有断言不动。
4. **500 用真断连制造,不 mock fetch**。词典就是 better-sqlite3,close
   后取词抛 SqliteError → Express 错误中间件 → 500 JSON,这条链本身就是
   被钉的契约。afterEach 的二次 close 在实例上用 no-op 顶替,不动共享
   夹具。

## 门禁

每个实现 commit:`npm run typecheck && npm test && npm run lint` 绿
(看退出码,不看 tail);收尾 `npm run verify` 全绿。行为信封:契约套件
既有断言零删除零改写,新增只追加;api.test.ts / reading.test.tsx 零改动。
唯一触及既有测试的编辑 = 票 02 对 409 测试的加盖(决策 3)。
