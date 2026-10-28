# 02: 扩展骨架：EPUB 打开到能读（无标注）

**What to build:** 从点扩展图标到读完一本 EPUB 的无标注骨架：选择或拖入文件 → 导入链 → 扩展阅读页分章渐进渲染。票内第一步验证服务端 EPUB 导入链的浏览器纯度（JSZip/DOMParser 皆浏览器原生，预期可复用）；若含 Node 专属依赖，把纯链等价搬移进共享包，服务端改为引入——只搬不改行为。错误路径面向用户明确报错，扩展保持可用。

**Blocked by:** None (can start immediately)

**Status:** done

依据：spec 导入链与错误路径决策；ADR-0006（无服务）。

- [ ] 点扩展图标出现入口，选择或拖入 EPUB 进入扩展阅读页
- [ ] 书按章节渐进加载，大书不整本卡死
- [ ] 导入链纯度结论记入本票 ## Comments；若提纯搬移，服务端行为零变更且全仓测试绿
- [ ] 加密/DRM、损坏档案分别得到明确提示；扫描版 PDF 按「书」词条提示不支持
- [ ] 测试：确定性 fixture EPUB 过全链 + 错误路径（JSZip fixture 建目录显式化，保证确定性）
- [ ] manifest 与 Vite 多入口构建就位，Edge load-unpacked 可加载

## Comments

**收官(2026-10-28,实现会话)**:实现 commit(HEAD~0,docs 搬移 commit 18e0da8 在前)。
全仓 verify 绿(389 测试/typecheck/eslint --max-warnings 0/三项 locality/含 extension 五包构建)。

- **导入链纯度结论(票内第一义务)**:esbuild --platform=browser 探针——cheerio 1.2、
  jszip、sbd 全链浏览器可打包(844KB unminified,undici/parse5-stream 未被静态到达);
  唯一 Node 依赖是 epub.ts 的 `node:path`(posix.dirname/join)。已按 spec 预案提纯:
  纯链搬进新共享包 `@lingualeaf/import-core`,`node:path` 换纯字符串实现
  (src/posix-path.ts,19 例形状对 node:path 实测逐例一致,含尾部斜杠与绝对路径 .. 截断)。
  **浏览器纯度现为常驻证明:extension 的 vite build 每次全仓 verify 都重跑。**
- **搬移清单(只搬不改行为)**:epub.ts(改 imports+签名 Uint8Array|ArrayBuffer)、
  extract-html.ts、sentences.ts 原文搬移;ImportErrorCode/ImportRejection/UploadRejected
  家园迁 import-core/src/rejection.ts,服务端 wire.ts/upload-rejection.ts 改再导出
  (REJECTION_STATUS 留守服务端——HTTP 是服务端的代价模型);PreparedBook/BookFormat
  迁 types.ts;sentences.test.ts 随迁;epub fixture 构建器迁 src/testing/(./testing 子路径
  导出,输出 Uint8Array,atob 解码,双宿可用),sample-book.epub 二进制与字节级钉子测试随迁;
  contract/epub-import 测试改经包子路径取构建器(supertest 接缝处 Buffer.from 一层)。
  服务端 221 测试零改写跑绿 = 行为不变的证明。
- **扩展骨架落法**:`@lingualeaf/extension`(apps/extension,Vite+TS+React,与 web 同构);
  MV3 manifest + 多入口(reader.html / service-worker.js 定名,manifest 引固定路径);
  SW 仅 action.onClicked → 开/聚焦 reader 页(无状态);阅读页 选择/拖入 → import-core 链 →
  目录+分章渐进渲染(一次一章,大书不整本渲染)+ 上下章;错误按共享 reason 码出文案
  (Record 编译器守卫,web importCopy 同式);FileReader 读文件(jsdom 兼容、真浏览器同形;
  jsdom 的 File 无 arrayBuffer(),实测)。
- **验证**:jsdom 三测(fixture EPUB 过全链断言分章分句/损坏档案文案且入口可复用/
  非 EPUB 拒绝文案);构建产物真 Chromium(CDP 驱动,playwright-core + 缓存二进制)冒烟:
  页面 boot、真实 File 进真实 input、书开渲染、零 pageerror;base './' 相对资产
  (file:// 与扩展 origin 双可开)。
- **勿忘(人手一步)**:Edge `edge://extensions` → 开发人员模式 → 加载解包 →
  选 `apps/extension/dist` → 点工具栏图标 → 选一本真 EPUB。构建产物已就位,
  真 Edge 加载属人工验收,07 票整装验收时一并走。
