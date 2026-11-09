import type { SpeakFailure } from "./speak-failure";

// The reader-facing speak failure flag (mobile-app ticket 09). The router
// raises a classified failure and this flag renders it: a missing engine
// and a failed synthesis read as two different sentences (CODING_STANDARDS,
// missing ≠ failed), the flag announces itself through role="alert", and
// it stays until the reader dismisses it — a transient toast would hide
// the fact from whoever looked away (credibility: the last state must not
// silently vanish).
type Props = { failure: SpeakFailure; onClose: () => void };

export function SpeakFailureFlag({ failure, onClose }: Props) {
  const copy =
    failure.kind === "engine-missing"
      ? "此设备没有可用的英语语音引擎，无法发音。可在系统设置安装语音引擎（如 Google 语音合成）后重试。"
      : "发音失败，请稍后再试。";
  return (
    <div className="speak-flag" role="alert">
      <span className="speak-flag-copy">{copy}</span>
      <button
        type="button"
        className="speak-flag-close"
        aria-label="关闭发音提示"
        onClick={onClose}
      >
        ✕
      </button>
    </div>
  );
}
