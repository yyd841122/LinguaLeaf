// 书架占位页（GLOSSARY：书架 = 已导入书的入口）。02 接真书架时整页
// 换装：组件名与导出落点保持不变，占位文案只保证空壳可启动可辨识。
export function BookshelfPage() {
  return (
    <main className="bookshelf">
      <h1 className="bookshelf__app">LinguaLeaf</h1>
      <section className="bookshelf__shelf">
        <h2>书架</h2>
        <p>还没有书，先导入一本吧。</p>
      </section>
    </main>
  );
}
