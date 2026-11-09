import { BookshelfPage } from "./BookshelfPage";

// 空壳路由形状（票 01）：应用启动的单一落点 = 书架页。02 接真书架时
// 在此换装，阅读路由随 reader 模块搬入时再扩展。
export function App() {
  return <BookshelfPage />;
}
