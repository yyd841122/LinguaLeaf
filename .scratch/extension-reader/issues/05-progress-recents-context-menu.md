# 05: 进度记忆 + 最近文档 + 右键入口

**What to build:** 重开扩展回到上次阅读位置；最近文档列表切换多本书；右键菜单「用 LinguaLeaf 打开」一步进阅读；断网下打开、标音、查词、改态全流程可用。进度与列表走存储 seam，不直调 chrome.*。

**Blocked by:** 02、03

**Status:** done

依据：spec 进度记忆与右键入口故事；数据自决（卸载即清）。

- [ ] 阅读位置按文档记忆，重开扩展回到原处
- [ ] 最近文档列表可切换多本书，各自进度独立
- [ ] 右键菜单「用 LinguaLeaf 打开」进入扩展阅读页
- [ ] 断网全流程验收记录进本票 ## Comments
- [ ] 进度/列表读写全部经由存储 seam

## Comments

**收官(2026-10-28,实现会话)**:全仓 verify 绿(421 测试)。

- **落法**:LibraryStore 为存储 seam 第二半(词状态之外:文档本体 + 进度 + 最近序),
  内存/chrome 双实现同词状态模式;文档 id 取书题(同书重导入原地更新);进度
  {chapterIndex, blockIndex} 与 web 同形——章节切换直写,滚动节流 400ms 写视口顶块;
  重开直达保存章 + scrollIntoView 落块;右键菜单在 SW(onInstalled 建,onClicked
  开/聚焦既有 reader 页),manifest +contextMenus。
- **勿忘(人手一步)**:真 Edge 里右键菜单与重开回位的人工验收随 07 整装一并走
  (SW 与 chrome.storage 的真实路径只有 load-unpacked 能踩到)。
- **断网全流程验收(票内义务,自动化等价证据)**:真 Chromium 冒烟记录——导入、
  音标、点词、改态、重开回位全程 **4 个请求全部本源(loopback 资产),外部请求
  0**;架构上扩展页无任何跨源调用(词典为打包资产,存储为 chrome.storage),
  断网下行为不变即成立。真·断网复验随 07 人工走。
- **边角两枚**:(1) 又一次 stale dist——冒烟首跑的 dist 还是 04 的,05 落地代码
  不在里面,静默「无最近文档」;改源后必须 rebuild 再冒烟(04 Comments 已记,
  本次再犯,故在此再记一笔);(2)OfflineDictionary 构造器现对缺表资产归一为
  空表(测试 stub 的 `{}` 资产让 `undefined[词]` 炸进导入链)。
