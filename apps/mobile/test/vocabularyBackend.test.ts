import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { OfflineDictionary } from "../src/dict/offline-dictionary";
import { createIdbNamespaceStorage } from "../src/store/idb-namespace-storage";
import {
  createStorageBackend,
  createVocabularyStore,
} from "../src/store/vocabulary-store";

// mobile-app 02 终审证据缺口①: the REAL backend — the one ReaderPage's
// composition root mounts (createVocabularyStore(offline,
// createStorageBackend(idbStorage))) — had no mutation catcher: deleting
// the persist step inside put/enroll left every behavior test green (the
// memory twin's synchronous map cannot see a lost write). Two store
// instances over one database — a killed app's reboot read-back — must
// carry every write through the record's serialized path.
const DICT = new OfflineDictionary({
  ipa: { woke: "woʊk" },
  inflections: { runs: "run" },
  entries: { woke: { p: "wəʊk", t: "v. 醒来" } },
});

describe("the storage-backed vocabulary store (the phone's composition)", () => {
  it("persists writes across instances: a fresh store reads the first's states", async () => {
    const factory = new IDBFactory();
    const first = createVocabularyStore(
      DICT,
      createStorageBackend(createIdbNamespaceStorage(factory))
    );
    // 查词即状态 enrolls through the record's queued write …
    expect((await first.lookup("Woke"))?.status).toBe("learning");
    // … and the popup's explicit set overrides it through the same path.
    await first.setStatus("woke", "known");

    // A fresh app mount builds new instances over the same database.
    const second = createVocabularyStore(
      DICT,
      createStorageBackend(createIdbNamespaceStorage(factory))
    );
    expect(await second.exportAll()).toEqual({ woke: "known" });
    expect((await second.statesFor(["woke"])).get("woke")).toBe("known");
    // The lookup path answers the persisted state, never re-enrolls.
    expect((await second.lookup("Woke"))?.status).toBe("known");
  });
});
