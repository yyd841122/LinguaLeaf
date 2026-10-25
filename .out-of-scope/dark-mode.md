# Dark Mode(暗色模式)

LinguaLeaf 不做暗色模式,也不做任何用户可切换主题。

## Why this is out of scope

产品定位是单用户、局域网自用的英文阅读工具,暗色模式服务的是「多用户/公共场景下的
偏好差异」,在这个定位下收益很小。且成本容易被低估:全站 14 个色值的调色板
(`apps/web/src/style.css`)按「白天纸感阅读」调校(米绿 `#ecefe6`、墨绿 `#22342a`
等),阅读页 + 书架 + 点词弹窗之外,导出模板(`apps/server/src/export/annotated-book.ts`)
还内嵌着第二套独立 CSS——暗色是一次跨两个界面的全调色板巡检,不是一个媒体查询,
之后每个新界面、每个新色值都要双份维护。

旧仓库 english-annotation-reader 的 p-1 原型有完整暗色适配,但那是「原型什么都有」
的产物,不构成移植理由。若未来产品定位变化(公开部署、多人使用),可重新评估;
届时删除本文件、走正常 triage 即可。

导出跟随系统暗色的问题随本决定一并搁置——它是「做暗色模式」的子项,从未独立立项。

## Prior requests

- `.scratch/dark-mode/issues/01-dark-mode.md`:暗色模式(prefers-color-scheme 全调色板),
  来源 2026-10-24 旧仓库复盘,2026-10-25 拒收
