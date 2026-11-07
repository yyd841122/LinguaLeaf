import { describe, expect, it } from "vitest";
import { createPdfPositionStore } from "../src/store/pdf-position-store";

const a = {
  docId: "pdf:sha256-v1:" + "a".repeat(64),
  title: "Same title",
  page: 2,
  scale: 1.5,
};
const b = {
  ...a,
  docId: "pdf:sha256-v1:" + "b".repeat(64),
  page: 3,
  scale: 0.75,
};
describe("PDF positions and latest-session convenience data", () => {
  it("keeps each identity's position and only the most recent hint, independently of notes", async () => {
    const bag: Record<string, unknown> = {};
    const storage = {
      async get() {
        return structuredClone(bag);
      },
      async set(next: Record<string, unknown>) {
        Object.assign(bag, structuredClone(next));
      },
    };
    const store = createPdfPositionStore(storage);
    expect(await store.getRecent()).toBeNull();
    expect(await store.getPosition(a.docId)).toBeNull();
    await Promise.all([store.setPosition(a), store.setPosition(b)]);
    expect(await store.getPosition(a.docId)).toEqual({
      docId: a.docId,
      page: 2,
      scale: 1.5,
    });
    expect(await store.getPosition(b.docId)).toEqual({
      docId: b.docId,
      page: 3,
      scale: 0.75,
    });
    expect(await createPdfPositionStore(storage).getRecent()).toEqual(b);
    expect(Object.keys(bag)).toEqual(["pdf-positions"]);
  });

  it("waits for position writes already sent before reselecting or reading the empty-state hint", async () => {
    const bag: Record<string, unknown> = {};
    const store = createPdfPositionStore({
      async get() {
        return structuredClone(bag);
      },
      async set(next) {
        Object.assign(bag, structuredClone(next));
      },
    });
    const saving = store.setPosition(a);
    const position = store.getPosition(a.docId);
    const recent = store.getRecent();
    await saving;
    expect(await position).toMatchObject({ page: 2, scale: 1.5 });
    expect(await recent).toEqual(a);
  });

  it("degrades read/write failures and malformed/unknown versions to missing without overwriting them", async () => {
    const store = createPdfPositionStore({
      async get() {
        throw new Error("read");
      },
      async set() {
        throw new Error("write");
      },
    });
    expect(await store.getRecent()).toBeNull();
    expect(await store.getPosition(a.docId)).toBeNull();
    await expect(store.setPosition(a)).resolves.toBeUndefined();
    const quota = createPdfPositionStore({
      async get() {
        return {};
      },
      async set() {
        throw new Error("quota");
      },
    });
    await expect(quota.setPosition(a)).resolves.toBeUndefined();
    for (const raw of [
      { version: 2 },
      { version: 1, positions: [{ ...a, page: 0 }], recent: a },
    ]) {
      let writes = 0;
      const invalid = createPdfPositionStore({
        async get() {
          return { "pdf-positions": raw };
        },
        async set() {
          writes++;
        },
      });
      expect(await invalid.getRecent()).toBeNull();
      expect(await invalid.getPosition(a.docId)).toBeNull();
      await invalid.setPosition(a);
      expect(writes).toBe(0);
    }
  });
});

describe("PDF shelf position snapshot and recent cleanup", () => {
  it("joins a single snapshot and serializes conditional recent clearing with writes", async () => {
    const bag: Record<string, unknown> = {};
    const store = createPdfPositionStore({
      async get() {
        return structuredClone(bag);
      },
      async set(next) {
        Object.assign(bag, structuredClone(next));
      },
    });
    await store.setPosition(a);
    await store.clearRecentIf(b.docId);
    expect(await store.getRecent()).toEqual(a);
    const writing = store.setPosition(b);
    const clearing = store.clearRecentIf(a.docId);
    await Promise.all([writing, clearing]);
    expect(await store.getRecent()).toEqual(b);
    await store.clearRecentIf(b.docId);
    expect(await store.getSnapshot()).toEqual({
      positions: [
        { docId: a.docId, page: a.page, scale: a.scale },
        { docId: b.docId, page: b.page, scale: b.scale },
      ],
      recent: null,
    });
  });
  it("propagates cleanup failure, preserves positions and can retry", async () => {
    let fail = false;
    const bag: Record<string, unknown> = {};
    const store = createPdfPositionStore({
      async get() {
        return structuredClone(bag);
      },
      async set(next) {
        if (fail) throw new Error("quota");
        Object.assign(bag, structuredClone(next));
      },
    });
    await store.setPosition(a);
    fail = true;
    await expect(store.clearRecentIf(a.docId)).rejects.toThrow("quota");
    expect(await store.getRecent()).toEqual(a);
    fail = false;
    await store.clearRecentIf(a.docId);
    expect(await store.getRecent()).toBeNull();
    expect(await store.getPosition(a.docId)).not.toBeNull();
  });
});
