# web 阅读页:章切换滚动重置(与 mobile 章滚动洞同型)

**Status:** wontfix

来自 mobile-md-import 真机 round 1 诊断的跨端一致性发现(2026-11-15)。
mobile 面已修:`EpubReader.goChapter` 切章补 `window.scrollTo(0, 0)`
(commit 见 `.scratch/mobile-md-import/issues/02-mobile-md-import.md` Comments)。

web 面 `apps/web/src/ReadingPage.tsx` 的「下一章 →」是 Link 路由跳转
(:770 附近),全文件未见章切换滚动重置(:313 的 scrollTo(0,0) 只服务
笔记跳转分支)。若 web 面滚动容器同为 window,同型洞应在:长章后切章,
视窗停留在继承偏移上。未实测(本票只诊了 mobile);诊断环配方可直接复用:
`scripts/browser-e2e/mobile-md-chapter-scroll.mjs` 改驱动 web dist,
或扩 `npm run browser-e2e` 的 reading-bookmarks-04 场景。

开放决策:先实测 web 面是否真红(React Router 路由切换可能自带
scroll restoration 语义,与 mobile 的组件内切换不同型,结论待测);
真红再修,修法可参照 mobile 的「视窗对齐 seam」契约。

## Comments

- 2026-11-15 mobile-md-import 真机诊断时立票(跨端一致性:同一阅读
  契约,web 面未见对应实现)。
- 2026-11-16 维护者判示:**网页版没有问题**,立票理由不成立,销票。
  与源码形态吻合:web 面章切换是 React Router 路由跳转(Link),非
  mobile 的组件内 setState 换章——路由切换自带滚动复位语义,同型洞
  不成立。若日后有人在 web 面复现「切章不停在章首」,再开新票,诊断
  环配方可复用(scripts/browser-e2e/mobile-md-chapter-scroll.mjs 改驱动
  web dist)。
