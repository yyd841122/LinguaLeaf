# mobile PDF/重排缺陷簇:段中笔记不可达 + 漂移保护缺失 + 重试断链 + 句末信号偏宽

**Status:** claimed

来自 mobile-app 03 独立终审发现 1/3/4/5/6(2026-11-16,threadId
01a1e1ea-a7e2-72c1-83c8-a5dda0a47c67,verdict NO-GO;只读含内存探针):

1. `PdfReflow.tsx:372`:段落笔钮只开段首行——段中已有笔记显示「编辑笔记」
   却打开空白编辑器(探针以第二行存量笔记复现)。保留段内各行笔记入口。
2. `PdfReflow.tsx:392`:重排编辑器仅按页/行号取笔记,缺画布面已有的
   `lineText` 漂移保护——错锚旧笔记可被打开并保存为当前行文本。
3. `PdfReflow.tsx:168`:「重试读取」只增 `attempt`,读取 effect 未依赖它
   且 owner 身份稳定 → 按钮点了不重读(探针调用次数仍 1)。接通重试依赖。
4. `PdfReflow.tsx:170`:笔记读取丢弃 `failed` 态,失败后所有笔钮持续
   禁用且无提示/重试(探针 alert 与重试按钮均 0)。镜像画布面失败恢复通道。
5. `pdf-lines.ts:176`:`endsSentence` 把单独闭引号/撇号当句末标点——
   短行 `words "Well,"` 触发段尾,偏离 v5「短行∧句末标点」契约。引号只作
   句末标点后的可选闭合符,补反例。

## Comments

- 2026-11-16 立票。书签面板清快照同款病(PdfReader.tsx:254)已并入
  `.scratch/mobile-bookmark-defects/`;证据缺口并入批扫票。

- 2026-11-16 Lane A 实现(Codex 审核排队,与 A-1~A-4 同批等配额):
  commit 16a2b1b(基线 4c9c57e)。五项全修:①段笔钮恒写段首行,其余
  有笔记行各挂内联行级笔钮(sideNotes;段笔钮不再盲开段首冒充「编辑
  笔记」);②lineText 漂移锁(禁笔) + drift 告示镜像画布面 + initial
  过滤加 lineText 带;③attempt 接进读取 effect deps;④笔记 failed 态
  出告示 + 重试读取笔记;⑤endsSentence 首字符类去引号,只留句末标点,
  引号降为可选闭合符。设计演化记一笔:曾令段笔钮指向首个匹配锚行,后
  因 sideNotes 已兜行级入口、该形状反而抢走段首 fresh-write 入口而简化
  为「段笔钮恒写段首」。CSS:.pdf-reflow 笔钮绝对定位收窄为
  .sentence-block 直接子级,行级笔钮内联。新测试 5 片,五变异精确咬合
  (各自缺陷变异仅红对应测试);全量 verify 108 文件 1213 测试绿。
  真机人验项挂账等机检(段中笔钮、drift 告示、两处重试)。
