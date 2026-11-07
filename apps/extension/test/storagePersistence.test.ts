import { describe, expect, it } from "vitest";
import { requestStoragePersistence } from "../src/store/storage-persistence";

describe("persistent storage request", () => {
  it("handles a grant", async () => {
    expect(await requestStoragePersistence({ persist: async () => true })).toBe(
      "granted"
    );
  });
  it("handles an explicit denial separately from a rejected promise", async () => {
    expect(
      await requestStoragePersistence({ persist: async () => false })
    ).toBe("denied");
  });
  it("handles a rejected promise without interrupting reading", async () => {
    expect(
      await requestStoragePersistence({
        persist: async () => {
          throw new Error("blocked");
        },
      })
    ).toBe("failed");
  });
  it("handles API absence", async () => {
    expect(await requestStoragePersistence({} as StorageManager)).toBe(
      "unavailable"
    );
  });
});
