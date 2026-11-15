import { describe, expect, it } from "vitest";
import {
  createMemoryUiSettingsStore,
  createUiSettingsStore,
} from "../src/store/ui-settings-store";

// The reader's global face preferences (ticket 03, round 14): toolbar
// position only so far. Read failures degrade to the default —
// convenience settings never block reading.

const storage = () => {
  const bag: Record<string, unknown> = {};
  return {
    async get() {
      return structuredClone(bag);
    },
    async set(next: Record<string, unknown>) {
      Object.assign(bag, structuredClone(next));
    },
  };
};

describe("UI settings — toolbar position", () => {
  it("defaults to top, persists a flip and reads it back", async () => {
    const store = createUiSettingsStore(storage());
    expect(await store.load()).toEqual({ pdfToolbar: "top" });
    await store.savePdfToolbar("bottom");
    expect(await store.load()).toEqual({ pdfToolbar: "bottom" });
  });

  it("degrades malformed or unknown records to the default without overwriting", async () => {
    const bag: Record<string, unknown> = {
      "ui-settings": { version: 99, pdfToolbar: "bottom" },
    };
    const store = createUiSettingsStore({
      async get() {
        return structuredClone(bag);
      },
      async set(next: Record<string, unknown>) {
        Object.assign(bag, structuredClone(next));
      },
    });
    // Malformed record reads as the default...
    expect(await store.load()).toEqual({ pdfToolbar: "top" });
    // ...and the next save replaces it with a valid record.
    await store.savePdfToolbar("bottom");
    expect(await store.load()).toEqual({ pdfToolbar: "bottom" });
  });

  it("memory twin carries the same shapes", async () => {
    const store = createMemoryUiSettingsStore();
    expect(await store.load()).toEqual({ pdfToolbar: "top" });
    await store.savePdfToolbar("bottom");
    expect(await store.load()).toEqual({ pdfToolbar: "bottom" });
  });
});
