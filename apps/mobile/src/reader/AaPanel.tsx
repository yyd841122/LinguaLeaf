import {
  FONT_STEPS,
  LINE_STEPS,
  MARGIN_STEPS,
  type ThemePreference,
  type Typography,
} from "../store/ui-settings-store";

// The Aa panel (redesign 02, spec round 2 #2): the typography ladders
// and the theme choice, one card shared by the EPUB and PDF faces —
// 字号 stepper over five steps, 边距/行距 segmented rows, 主题 four
// picks driven live through the theme hook's save. The face owns the
// veil; this is the card's content.
export function AaPanel({
  typography,
  onTypography,
  theme,
}: {
  typography: Typography;
  onTypography: (steps: Partial<Typography>) => void;
  theme: {
    preference: ThemePreference;
    save: (next: ThemePreference) => void;
  };
}) {
  return (
    <>
      <h2 className="overlay-title">排版与主题</h2>
      <div className="aa-row" role="group" aria-label="字号">
        <button
          type="button"
          aria-label="减小字号"
          disabled={typography.fontStep === 0}
          onClick={() =>
            onTypography({
              fontStep: Math.max(0, typography.fontStep - 1),
            })
          }
        >
          A－
        </button>
        <span className="aa-value">{FONT_STEPS[typography.fontStep]}</span>
        <button
          type="button"
          aria-label="增大字号"
          disabled={typography.fontStep === FONT_STEPS.length - 1}
          onClick={() =>
            onTypography({
              fontStep: Math.min(
                FONT_STEPS.length - 1,
                typography.fontStep + 1
              ),
            })
          }
        >
          A＋
        </button>
      </div>
      <div className="aa-row" role="group" aria-label="边距">
        {MARGIN_STEPS.map((value, index) => (
          <button
            type="button"
            key={value}
            aria-pressed={typography.marginStep === index}
            onClick={() => onTypography({ marginStep: index })}
          >
            {["窄", "适中", "宽"][index]}
          </button>
        ))}
      </div>
      <div className="aa-row" role="group" aria-label="行距">
        {LINE_STEPS.map((value, index) => (
          <button
            type="button"
            key={value}
            aria-pressed={typography.lineStep === index}
            onClick={() => onTypography({ lineStep: index })}
          >
            {value}
          </button>
        ))}
      </div>
      <div className="aa-row" role="group" aria-label="主题">
        {(
          [
            ["system", "跟随系统"],
            ["paper", "暖纸"],
            ["white", "白"],
            ["night", "夜间"],
          ] as const
        ).map(([value, label]) => (
          <button
            type="button"
            key={value}
            aria-pressed={theme.preference === value}
            onClick={() => theme.save(value)}
          >
            {label}
          </button>
        ))}
      </div>
    </>
  );
}
