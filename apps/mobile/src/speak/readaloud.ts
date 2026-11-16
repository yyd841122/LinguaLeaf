// The read-aloud player (mobile-app ticket 07, GLOSSARY 听书): one
// sentence-shaped timeline over a book's sentence blocks, played through
// an injected speaker. Pure logic — the host owns React and the seams;
// jsdom tests drive a fake speaker's deferred promises.
//
// Continuation chains on the speaker's contract: speak() resolves when
// the utterance FINISHES, so the loop's await IS the sentence boundary.
// Every interrupting move (pause, stop, jump, rate change while live)
// bumps a generation counter and flushes the utterance — the abandoned
// loop's await then resolves (or rejects) into a generation it no longer
// owns and dies silently, exactly the owner-token rule for an async
// walk with no React around it.

import { isSpeakRejection, type SpeakFailureKind } from "./speak-failure";

export type ReadAloudSentence = {
  chapterIndex: number;
  blockIndex: number;
  text: string;
};

export type ReadAloudPhase = "idle" | "playing" | "paused";

export type ReadAloudState = {
  phase: ReadAloudPhase;
  // Index into the flat sentence timeline; null while idle.
  at: number | null;
  rate: number;
};

export interface ReadAloudSpeaker {
  speak(text: string, lang: string, rate?: number): Promise<void>;
  stop(): Promise<void>;
}

export interface ReadAloudDeps {
  sentences: ReadAloudSentence[];
  speaker: ReadAloudSpeaker;
  lang?: string;
  /** Announced on every sentence COMPLETION (the progress-follow seam). */
  onPosition(sentence: ReadAloudSentence): void;
  /** A failed utterance retires the walk; the host renders the flag. */
  onFailure(kind: SpeakFailureKind): void;
  /** Announced when the book's last sentence lands (idle, position kept). */
  onFinished?(): void;
}

export const READALOUD_RATES = [0.75, 1, 1.25, 1.5] as const;

export interface ReadAloudPlayer {
  getState(): ReadAloudState;
  subscribe(listener: (state: ReadAloudState) => void): () => void;
  /** Play from `at` (paused resume) or the given start index. */
  play(from?: number): void;
  pause(): void;
  stop(): void;
  /** Jump ±1 sentence; a live walk restarts at the new sentence. */
  step(delta: 1 | -1): void;
  /** Applies immediately: a live sentence restarts at the new rate. */
  setRate(rate: number): void;
}

export function createReadAloudPlayer(
  deps: ReadAloudDeps,
  initialRate = 1
): ReadAloudPlayer {
  const { sentences, speaker } = deps;
  const lang = deps.lang ?? "en-US";
  let state: ReadAloudState = { phase: "idle", at: null, rate: initialRate };
  const listeners = new Set<(state: ReadAloudState) => void>();
  let generation = 0;

  const notify = (next: ReadAloudState) => {
    state = next;
    for (const listener of [...listeners]) listener(state);
  };

  const clampIndex = (index: number): number =>
    Math.max(0, Math.min(index, sentences.length - 1));

  const run = (gen: number, startIndex: number) => {
    notify({ ...state, phase: "playing", at: startIndex });
    const walk = async () => {
      let at = startIndex;
      while (gen === generation) {
        const sentence = sentences[at];
        if (!sentence) break;
        try {
          await speaker.speak(sentence.text, lang, state.rate);
        } catch (cause) {
          if (gen !== generation) return; // superseded mid-utterance
          notify({ ...state, phase: "idle" });
          deps.onFailure(
            isSpeakRejection(cause) ? cause.kind : "synthesis-failed"
          );
          return;
        }
        if (gen !== generation) return; // interrupted between sentences
        deps.onPosition(sentence);
        // The book's last sentence landed: idle with the cursor ON it
        // (a replay or step-back works from there, never past the end).
        if (at >= sentences.length - 1) {
          notify({
            ...state,
            phase: "idle",
            at: sentences.length - 1,
          });
          deps.onFinished?.();
          return;
        }
        at += 1;
        notify({ ...state, at });
      }
    };
    void walk();
  };

  const interrupt = async (): Promise<number> => {
    generation += 1;
    await speaker.stop().catch(() => undefined);
    return generation;
  };

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    play(from?: number) {
      if (!sentences.length) return;
      const startIndex =
        from !== undefined
          ? clampIndex(from)
          : state.at !== null
            ? clampIndex(state.at)
            : 0;
      if (state.phase === "playing" && state.at === startIndex) return;
      if (state.phase === "playing") {
        // A live utterance must be flushed before the new one may speak.
        void interrupt().then((gen) => run(gen, startIndex));
      } else {
        // Idle/paused: nothing of ours is in flight — take the
        // generation without a pointless stop round-trip.
        generation += 1;
        run(generation, startIndex);
      }
    },
    pause() {
      if (state.phase !== "playing") return;
      // The paused phase lands only if nothing newer moved while the
      // flush was in flight — a play() that raced the flush owns the
      // state instead.
      const genAtPause = generation;
      void interrupt().then((gen) => {
        if (gen === genAtPause + 1) notify({ ...state, phase: "paused" });
      });
    },
    stop() {
      const genAtStop = generation;
      void interrupt().then((gen) => {
        if (gen === genAtStop + 1)
          notify({ ...state, phase: "idle", at: null });
      });
    },
    step(delta: 1 | -1) {
      if (state.at === null) return;
      const target = clampIndex(state.at + delta);
      if (state.phase === "playing") {
        void interrupt().then((gen) => run(gen, target));
      } else {
        notify({ ...state, at: target });
      }
    },
    setRate(rate: number) {
      if (state.phase === "playing" && state.at !== null) {
        const at = state.at;
        void interrupt().then((gen) => {
          notify({ ...state, rate });
          run(gen, at);
        });
      } else {
        notify({ ...state, rate });
      }
    },
  };
}
