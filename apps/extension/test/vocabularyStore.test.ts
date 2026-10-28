import { describe, expect, it } from "vitest";
import {
  OfflineDictionary,
  type BakedDictionary,
} from "../src/dict/offline-dictionary";
import {
  createVocabularyStore,
  memoryBackend,
} from "../src/store/vocabulary-store";

const DICT_DATA: BakedDictionary = {
  ipa: { woke: "woʊk", run: "rʌn" },
  inflections: { runs: "run" },
  entries: { woke: { p: "", t: "v. 醒来" }, run: { p: "", t: "v. 跑" } },
};
const store = () =>
  createVocabularyStore(new OfflineDictionary(DICT_DATA), memoryBackend());

describe("VocabularyStore — 查词即状态 (ticket 04)", () => {
  it("a first lookup enrolls the lemma as Learning in the same call", async () => {
    const backend = memoryBackend();
    const vocab = createVocabularyStore(
      new OfflineDictionary(DICT_DATA),
      backend
    );
    const found = await vocab.lookup("Woke");
    expect(found?.status).toBe("learning");
    expect(backend.map.get("woke")).toBe("learning");
  });

  it("a recorded state stands — lookups never overwrite", async () => {
    const backend = memoryBackend();
    backend.map.set("run", "known");
    const vocab = createVocabularyStore(
      new OfflineDictionary(DICT_DATA),
      backend
    );
    const found = await vocab.lookup("runs");
    expect(found?.status).toBe("known");
    expect(found?.lemma).toBe("run");
    expect(backend.map.get("run")).toBe("known");
  });

  it("a dictionary miss writes nothing and answers null", async () => {
    const backend = memoryBackend();
    const vocab = createVocabularyStore(
      new OfflineDictionary(DICT_DATA),
      backend
    );
    expect(await vocab.lookup("xqzzz")).toBeNull();
    expect(backend.map.size).toBe(0);
  });

  it("setStatus is explicit and idempotent; statesFor reads in bulk", async () => {
    const vocab = store();
    await vocab.setStatus("woke", "ignored");
    await vocab.setStatus("woke", "ignored");
    const states = await vocab.statesFor(["woke", "run"]);
    expect(states.get("woke")).toBe("ignored");
    expect(states.has("run")).toBe(false);
  });
});
