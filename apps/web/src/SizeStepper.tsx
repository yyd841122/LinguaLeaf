// Stepper shared by the annotation size controls (IPA and original text):
// A− / label+value / A+, one pixel per click, bounds enforced by the caller
// through min/max and its own clamp on onChange.
export function SizeStepper({
  label,
  size,
  min,
  max,
  onChange,
}: {
  label: string;
  size: number;
  min: number;
  max: number;
  onChange: (size: number) => void;
}) {
  return (
    <div className="size-stepper">
      <button
        type="button"
        aria-label={`调小${label}字号`}
        disabled={size <= min}
        onClick={() => onChange(size - 1)}
      >
        A−
      </button>
      <span className="size-value" aria-live="polite">
        {label} {size}
      </span>
      <button
        type="button"
        aria-label={`调大${label}字号`}
        disabled={size >= max}
        onClick={() => onChange(size + 1)}
      >
        A+
      </button>
    </div>
  );
}
