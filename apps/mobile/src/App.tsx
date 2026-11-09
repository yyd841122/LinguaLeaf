import type { ComponentProps } from "react";
import { ReaderPage } from "./reader/ReaderPage";

// 票 02 换装:书架与阅读链路整页交给 reader 模块的 ReaderPage ——
// ReaderLanding 即书架(recents + 文件选择),阅读路由随 reader 模块
// 搬入落在同一页。注入参数仅供测试驱动 memory 后端;真机全部走
// ReaderPage 默认的 IndexedDB 后端(票 02:纯 IDB,零原生插件)。
export function App(props: ComponentProps<typeof ReaderPage>) {
  return <ReaderPage {...props} />;
}
