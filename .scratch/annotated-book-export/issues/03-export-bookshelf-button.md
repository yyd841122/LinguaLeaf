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
