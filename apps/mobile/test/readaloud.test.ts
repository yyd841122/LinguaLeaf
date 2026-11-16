import { describe, expect, it, vi } from "vitest";
import {
  createReadAloudPlayer,
  type ReadAloudSentence,
  type ReadAloudSpeaker,
} from "../src/speak/readaloud";
import { SpeakRejectionError } from "../src/speak/speak-failure";

// The read-aloud player (ticket 07): sentence-shaped timeline over the
// book's sentence blocks. The fake speaker's deferred promises ARE the
// sentence boundaries — the tests resolve them by hand and watch the
// walk advance, exactly what the native plugin's finish-resolved speak
// does on the device.

function fakeSpeaker() {
  type Pending = {
    resolve: () => void;
    reject: (error: Error) => void;
  };
  const pending: Pending[] = [];
  const calls: ({ text: string } & { rate?: number })[] = [];
  let stopCalls = 0;
  const speaker: ReadAloudSpeaker = {
    speak(text: string, _lang: string, rate?: number) {
      calls.push(rate === undefined ? { text } : { text, rate });
      return new Promise<void>((resolve, reject) =>
        pending.push({ resolve, reject })
      );
    },
    stop() {
      stopCalls += 1;
      // The plugin flushes: the in-flight utterance settles now.
      pending.splice(0).forEach((utterance) => utterance.resolve());
      return Promise.resolve();
    },
  };
  return {
    speaker,
    calls,
    stopCalls: () => stopCalls,
    resolve(index = 0) {
      pending.splice(index, 1)[0]?.resolve();
    },
    reject(index: number, error: Error) {
      pending.splice(index, 1)[0]?.reject(error);
    },
    pendingCount: () => pending.length,
  };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

const SENTENCES: ReadAloudSentence[] = [
  { chapterIndex: 0, blockIndex: 1, text: "First sentence." },
  { chapterIndex: 0, blockIndex: 3, text: "Second sentence." },
  { chapterIndex: 1, blockIndex: 0, text: "Chapter two opens." },
];

function makePlayer(
  speaker: ReadAloudSpeaker,
  hooks: {
    onPosition?: (sentence: ReadAloudSentence) => void;
    onFailure?: (kind: "engine-missing" | "synthesis-failed") => void;
    onFinished?: () => void;
  } = {}
) {
  return createReadAloudPlayer({
    sentences: SENTENCES,
    speaker,
    onPosition: hooks.onPosition ?? (() => undefined),
    onFailure: hooks.onFailure ?? (() => undefined),
    ...(hooks.onFinished ? { onFinished: hooks.onFinished } : {}),
  });
}

describe("read-aloud player", () => {
  it("chains sentences in order, reporting each completion, ending idle", async () => {
    const fake = fakeSpeaker();
    const positions: ReadAloudSentence[] = [];
    const finished = vi.fn();
    const player = makePlayer(fake.speaker, {
      onPosition: (sentence) => positions.push(sentence),
      onFinished: finished,
    });

    player.play();
    await tick();
    expect(fake.calls.map((call) => call.text)).toEqual(["First sentence."]);

    fake.resolve();
    await tick();
    expect(positions).toEqual([SENTENCES[0]]);
    expect(player.getState().at).toBe(1);
    expect(fake.calls[1]?.text).toBe("Second sentence.");

    fake.resolve();
    await tick(); // the walk issues sentence two's utterance
    fake.resolve();
    await tick(); // …and sentence three's
    fake.resolve();
    await tick();
    // All three landed (the third crosses the chapter boundary), the
    // book finished: idle, position kept at the last sentence.
    expect(positions).toEqual(SENTENCES);
    expect(player.getState()).toMatchObject({ phase: "idle", at: 2 });
    expect(finished).toHaveBeenCalledTimes(1);
  });

  it("pause flushes the utterance and holds the sentence; resume replays it", async () => {
    const fake = fakeSpeaker();
    const positions: ReadAloudSentence[] = [];
    const player = makePlayer(fake.speaker, {
      onPosition: (sentence) => positions.push(sentence),
    });

    player.play();
    await tick();
    player.pause();
    await tick();
    await tick();
    expect(player.getState()).toMatchObject({ phase: "paused", at: 0 });
    expect(fake.stopCalls()).toBe(1);
    // The flushed utterance resolved — but the superseded walk may not
    // advance on it.
    await tick();
    expect(positions).toEqual([]);
    expect(fake.pendingCount()).toBe(0);

    player.play();
    await tick();
    // Resume replays the held sentence from its start.
    expect(fake.calls[1]?.text).toBe("First sentence.");
    fake.resolve();
    await tick();
    expect(positions).toEqual([SENTENCES[0]]);
  });

  it("step jumps while live (restart at target) and while paused (move only)", async () => {
    const fake = fakeSpeaker();
    const player = makePlayer(fake.speaker);

    player.play();
    await tick();
    fake.resolve();
    await tick();
    expect(player.getState().at).toBe(1);

    player.step(1);
    await tick();
    // The restart speaks the TARGET sentence, rate kept.
    expect(fake.calls.at(-1)?.text).toBe("Chapter two opens.");
    expect(player.getState()).toMatchObject({ phase: "playing", at: 2 });

    player.pause();
    await tick();
    player.step(-1);
    expect(player.getState()).toMatchObject({ phase: "paused", at: 1 });
    expect(fake.calls.at(-1)?.text).toBe("Chapter two opens.");
  });

  it("a rate change applies immediately: the live sentence restarts at it", async () => {
    const fake = fakeSpeaker();
    const player = makePlayer(fake.speaker);

    player.play();
    await tick();
    expect(fake.calls[0]?.rate).toBe(1);
    player.setRate(1.5);
    await tick();
    await tick();
    expect(fake.calls.at(-1)).toEqual({ text: "First sentence.", rate: 1.5 });
    expect(player.getState().rate).toBe(1.5);
    fake.resolve();
    await tick();
    expect(fake.calls.at(-1)).toEqual({
      text: "Second sentence.",
      rate: 1.5,
    });
  });

  it("a failed utterance retires the walk classified, keeping the sentence for retry", async () => {
    const fake = fakeSpeaker();
    const failures: string[] = [];
    const player = makePlayer(fake.speaker, {
      onFailure: (kind) => failures.push(kind),
    });

    player.play();
    await tick();
    fake.reject(0, new SpeakRejectionError("engine-missing"));
    await tick();
    expect(failures).toEqual(["engine-missing"]);
    expect(player.getState()).toMatchObject({ phase: "idle", at: 0 });

    // Retry speaks the same sentence again.
    player.play();
    await tick();
    expect(fake.calls.at(-1)?.text).toBe("First sentence.");
  });

  it("play(from) starts mid-book; a racing play past a pause owns the state", async () => {
    const fake = fakeSpeaker();
    const player = makePlayer(fake.speaker);

    player.play(2);
    await tick();
    expect(fake.calls[0]?.text).toBe("Chapter two opens.");

    // Pause, then play again BEFORE the pause's flush lands: the pause's
    // late notify must not overwrite the new walk's state.
    player.pause();
    player.play(0);
    await tick();
    await tick();
    expect(player.getState()).toMatchObject({ phase: "playing", at: 0 });
    expect(fake.calls.at(-1)?.text).toBe("First sentence.");
  });
});
