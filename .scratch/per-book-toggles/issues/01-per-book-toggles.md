# prefs 按书键:四个偏好迁到 book:<id>:<pref>,旧全局键一次性回落

Status: done
Type: task

按 `../spec.md` 落地。语义已定,无需再 grilling;若实现中发现回落语义有坑(如同一浏览器
多书并存首次读取),在 Comments 里记录处置再继续。

## Comments

- 2026-10-25 (Claude): 实现。**按书键**:prefs.ts 泛化为 `readStoredBookNumber/readStoredBookBoolean/useStoredBookNumber/useStoredBookBoolean`,键 `book:<id>:<pref>`,五个 pref 名收进 `BookPref` 联合类型(键名清单一处,拼错即编译错);ReadingPage 五钩子传路由 bookId。**回落**:按书键缺失读旧全局键一次,旧键只读不写;按书键在但值坏 → 默认、不回落(「缺失时」字面语义且更安全,测试钉住);挂载/换键首写即把回落值固化到按书键,此后旧键不再被读。**换书跟随**:useState 初始化器每挂载只跑一次,书架→另一本书组件不卸载,渲染期 prevKey adjust 跟随新书键(React 认可模式)。**非法 bookId**(坏路由 Number→NaN):读默认、不落盘,无 `book:NaN:*` 垃圾。**守护语义不变**:读写全 try/catch,localStorage 坏死降级默认值,读写两侧各补坏死钉子测试。
- **范围处置(票面预料之坑)**:spec 写「四个偏好」,导语称「两个字号」,实现核对基线代码为**五个**全局键(原文行字号 originalSize 系票 05 后期泛化,复盘漏计)。按动因「不同材料难度不同,偏好随书保存」五键全迁——留在全局会让同一设置面板两套记忆规则,回落故事也不自洽;spec 导语与枚举已更正并注明来源。Spec 轴评审独立复核:判定 faithful-to-intent,非 scope creep。
- **code-review 双轴**(基线 6ca4196)。Standards 零硬违规,5 条 judgment-call 处置:prefs.ts 读者/钩子重复 → 已合并(单读路径 `readBookPref<T>` + 单状态核 `useBookStoredValue<T>`,守护注释随之归一);pref 裸字符串 → 已修(`BookPref` 联合);两 describe 的 beforeEach 键清单/clearAnnotationToggles 字面量 → 不改(清单即各 describe 触及键的 fixture,两处不足抽 helper;键字面量是契约钉);(bookId, pref, fallback, clamp) 数据团 → 合并后已收缩,per-pref spec 对象属更大重构,暂缓;轻度 shotgun surgery(五钩子分居 ReadingSettings/IpaSizeControl)→ 字号边界与步进器同址系既有设计,记录不改。Spec 轴一个休眠语义记录:纯读者函数(`readStoredIpaSize` 等)在按书键缺失时每次调用都回落,非严格「一次」——生产读路径全走钩子(挂载即固化),读者函数现无生产调用点;后续若加只读消费者,需先固化或改走钩子。
- **门禁**(退出码已验):`npm run verify` 全绿(typecheck + 305/305 + lint + check:sql-locality + check:task-lifecycle + build);reading 缝 42/42(新增 13:键优先/缺失回落/坏值不回落/非法 id/坏死读写钉/跨书跟随/旧键只读固化)。
- **人工验收提示**(非强制):真机浏览器开两本书,各自调显示设置互不串、换书回来各自记住;老用户升级场景:预置旧 `lingualeaf.*` 键的 localStorage 首次打开,偏好无缝带过且旧键字节不变。- 2026-10-25 (用户): 真机人工验收通过——两本书显示设置互不串,旧全局键偏好无缝迁移。
