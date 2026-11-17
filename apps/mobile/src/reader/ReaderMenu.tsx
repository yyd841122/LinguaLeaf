// The summonable reader chrome (redesign 02): hidden while reading —
// the face carries zero resident chrome (the ticket's first acceptance
// gate) — and when the face summons it (a background tap), two fixed
// bars frame the page: ← 返回 | 书名·章节名 | 进度 above, the face's
// item row below (EPUB and PDF differ only in their items). Panels are
// NOT rendered here: the face owns its overlays (目录 / 书签 / 听书 /
// Aa); the menu reports the selection and the face opens its panel.

export type ReaderMenuItem = {
  key: string;
  label: string;
  // Toggle rows (音标 / 译文) ride aria-pressed so the pressed state
  // stays honest to assistive tech; plain actions omit it.
  active?: boolean;
  // Locked rows (翻译 while a task runs or nothing is configured) keep
  // their slot but refuse the tap — the affordance stays discoverable.
  disabled?: boolean;
};

export function ReaderMenu({
  open,
  title,
  progress,
  items,
  onBack,
  onSelect,
}: {
  open: boolean;
  title: string;
  progress: string;
  items: ReaderMenuItem[];
  onBack?: () => void;
  onSelect?: (key: string) => void;
}) {
  if (!open) return null;
  return (
    <>
      <div className="reader-menu-top" role="group" aria-label="阅读菜单顶栏">
        <button type="button" className="reader-menu-back" onClick={onBack}>
          返回
        </button>
        <span className="reader-menu-title">{title}</span>
        <span className="reader-menu-progress">{progress}</span>
      </div>
      <nav className="reader-menu-bottom" aria-label="阅读菜单">
        {items.map((item) => (
          <button
            type="button"
            key={item.key}
            className="reader-menu-item"
            aria-pressed={item.active === undefined ? undefined : item.active}
            disabled={item.disabled}
            onClick={() => onSelect?.(item.key)}
          >
            {item.label}
          </button>
        ))}
      </nav>
    </>
  );
}
