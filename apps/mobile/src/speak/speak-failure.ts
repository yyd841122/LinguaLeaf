// The reader-facing failure taxonomy for the speak path (mobile-app
// ticket 09): a missing engine and a failed synthesis read differently,
// so they travel as distinct kinds (CODING_STANDARDS, missing ≠ failed).
export type SpeakFailureKind = "engine-missing" | "synthesis-failed";

export type SpeakFailure = { kind: SpeakFailureKind };

// The native adapter's rejection: every plugin failure arrives classified,
// so the router never has to guess from error strings.
export class SpeakRejectionError extends Error {
  readonly kind: SpeakFailureKind;
  readonly detail: unknown;

  constructor(kind: SpeakFailureKind, detail?: unknown) {
    super(
      kind === "engine-missing"
        ? "no usable speech engine for this language"
        : "speech synthesis failed"
    );
    this.name = "SpeakRejectionError";
    this.kind = kind;
    this.detail = detail;
  }
}

export function isSpeakRejection(error: unknown): error is SpeakRejectionError {
  return error instanceof SpeakRejectionError;
}
