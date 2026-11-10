// The reader-facing translation failure flag (mobile-app ticket 04). A
// chapter that settles with nothing translated — a wrong key, a network
// outage — must never read as silence: the flag announces itself through
// role="alert" and stays until the reader dismisses it or a fresh attempt
// starts (the speak flag's credibility rule: the last state must not
// silently vanish). The copy names both plausible causes and points at
// the settings page, because the total Translator contract reports both
// the same way.
export function TranslateFailureFlag({
  message,
  onClose,
}: {
  message: string;
  onClose: () => void;
}) {
  return (
    <div className="translate-flag" role="alert">
      <span className="translate-flag-copy">{message}</span>
      <button
        type="button"
        className="translate-flag-close"
        aria-label="关闭翻译提示"
        onClick={onClose}
      >
        ✕
      </button>
    </div>
  );
}
