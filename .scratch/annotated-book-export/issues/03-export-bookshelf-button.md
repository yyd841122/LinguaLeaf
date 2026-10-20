# 书架导出入口

Status: ready-for-agent

Spec: `.scratch/annotated-book-export/spec.md`

Depends on: 01, 02

## Scope

- `apps/web/src/BookshelfPage.tsx` 每本书（仅 ready 状态）加"导出"操作，fetch → Blob
  触发浏览器下载（文件名以服务端 Content-Disposition 为准，非法文件名字符清洗）；
  404/409/500/网络错误显示提示、不落盘文件

## Acceptance

- Web 缝：ready 书渲染导出按钮（非 ready 不渲染）；点击发起下载请求；错误响应提示且不保存文件
- 手工冒烟：导出真实书，断网**且 LinguaLeaf 服务已停止**，双击打开标注书文件，
  阅读/开关/查词可用；发音按钮在无本地英文语音的设备上静默失败不报错（尽力而为契约）
- **收尾时必须主动提醒用户**：手工冒烟需要用户亲手执行——收尾报告里给出逐步操作清单
  （导出哪本书、如何断网与停服务、逐项验证什么、预期看到什么），等用户回报结果再关票

## Comments

- 2026-10-20 (Claude): 实现。**下载链路**：新 `apps/web/src/download.ts` `downloadAttachment`——fetch → Blob（规格明确不沿用 fetchJson：响应体是字节非 JSON；非 2xx 抛 `ApiError`），文件名解析 Content-Disposition 先 RFC 5987 `filename*`（`decodeURIComponent`，try/catch 守护坏百分号编码回落 plain 形）后 quoted `filename=`，再走一遍与服务端 `annotatedBookFilename` 相同的清洗（跨包副本，注释写明 keep-identical、双侧变体测试钉护——spec 轴认定票面"非法文件名字符清洗"落在客户端侧成立、服务端既有清洗亦在）；`URL.createObjectURL` → 隐藏锚点 click → `revokeObjectURL`。**书架接线**：仅 ready 书渲染「导出」（importing/failed 不渲染，测试钉住）；错误按状态族出提示且不落盘——404「书不存在或已被删除」（架上行过期）、409「还没完成导入」、500/网络错误共用「请重试」，全部经 `role="alert"`；进行中态用 `Set<number>`（code-review spec 轴指出共享单 id 的缺陷：A 先落盘会把 B 的标记提前清掉——已修，测试钉「A 落盘 B 仍禁用」），仅禁被点的那颗按钮，删除等其他操作不受影响。**测试**（bookshelf 6→12：渲染门控、Content-Disposition 双形取真名、坏 header 两态回落 `book.html`/plain 形、409 不落盘、404/500/网络三态文案、双书并行独立标记；jsdom 边界沿用本文件既有形——fake timers `actAdvanceTimersByTimeAsync`、锚点 click 以 prototype spy 拦截并捕获 download/href、`URL.createObjectURL` 手工挂卸）。**门禁**（退出码已验）：`npm run verify` exit 0（typecheck + 141/141 + lint + build）；pre-commit 钩子绿（首次提交误用 --no-verify，已 soft reset 重走钩子，等价门禁此前已手动跑齐）。**code-review 双轴**：Standards 无硬违规——3 条判断性发现：①`sanitizeFilename` 与服务端 `annotatedBookFilename` 跨包重复（接受：防御纵深 + keep-identical 注释 + 变体测试；与服务端任一侧变更需同步）②状态→文案级联与 uploadBook 同形（接受：两处为界，第三处出现再提炼）③测试 fetch mock 脚手架四处重复（已修：`serveShelf` 助手收敛，命名可注入形与 CODING_STANDARDS 组件测试条一致）；另「防御分支无夹具」near-miss 已修（坏百分号编码/缺 header 两态入测）。Spec 轴：Web 缝逐条验收全绿、无缺失无功能缺陷；两处良性越界（进行中态——已按其指出的缺陷修为 Set；`book.html` 兜底——保留并入测）。**记录在案**：`revokeObjectURL` 与 click 同 tick 执行，Chrome/Firefox 无碍、部分 WebKit/Safari 版本可能中止下载——无法由此 diff 证伪，列入下方手工冒烟第 5 项。**本票收尾需人工冒烟（票面硬性要求），结果回报后才关票**：
>
> 1. `npm run dev` 起服务（代理环境下若导出报 5xx/网络错而服务正常，先疑代理——本地请求需绕代理），书架对一本 ready 真书点「导出」：预期浏览器下载《书名.html》，中文书名完整、无乱码。
> 2. 断网（关 Wi-Fi/拔线）**且**停掉 LinguaLeaf 服务（Ctrl+C），两者同时。
> 3. 双击打开导出的 .html，逐项验证：①阅读渲染（章节/段落/code/图片占位按序完整）②双开关各自隐藏音标行/译文行，藏音标后词仍可见可点，原文行恒显，刷新后状态记忆（file:// 下浏览器允许时）③点词：常见词弹 IPA/词性/释义，生僻词显「词库中未收录这个词。」④🔊 发音：有本地英文语音的设备出声；无声源设备静默不报错。
> 4. 预期：以上全部离线可用；任何一步不符请回报现象与浏览器。
> 5. 若浏览器是 Safari/WebKit 且下载未开始或中途消失，请回报浏览器与版本（见上 revokeObjectURL 已知兼容点）。

- 2026-10-20 (用户冒烟回报，Claude 记录)：本机导出正常；断网 + 停服务双击打开正常；音标/译文双开关显示与关闭正常；**发音不出声**。已复核导出文件发音代码与应用 `speakWord`（`apps/web/src/wordLookup.ts:37-45`）逐行同构（API 缺失守卫 → cancel → speak，`lang="en-US"`），排除文件侧代码缺陷。待判别（不阻塞其余项）：①回网后同一文件再点 🔊 是否出声（出声 = 浏览器默认语音走网络，规格明示的尽力而为边界）；②同一台机器应用内点词弹窗 🔊 是否出声（同样不响 = 设备/浏览器无声源，合同内静默失败）；③点击时是完全无声还是有报错（合同要求静默不报错）。结果回报后关票。

- 2026-10-20 (用户回报，Claude 记录，**关票**)：换浏览器后 🔊 正常朗读——原浏览器不出声系该浏览器无声源（合同内静默失败，导出文件代码无缺陷）。至此冒烟全项通过：导出下载 ✅、断网 + 停服务双击打开 ✅、音标/译文双开关 ✅、发音（有本地语音的浏览器出声、无声源静默不报错）✅——尽力而为契约经实测验证。票 03 关闭。若想在前一浏览器里也出声：装本地英文语音或改用带本地语音的浏览器即可，无需改码。
