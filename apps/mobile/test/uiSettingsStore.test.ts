import { describe, expect, it } from "vitest";
import {
  createMemoryUiSettingsStore,
  createUiSettingsStore,
} from "../src/store/ui-settings-store";

// The reader's global face preferences. Redesign ticket 01: the record
// grew a manual theme choice (暖纸 | 白 | 夜间 | 跟随系统) and the
// version 1 pdfToolbar item retired with the migration — ticket 02
// removes its UI. Read failures degrade to the default — convenience
// settings never block reading.

const storedBag = (record: unknown) => {
  const bag: Record<string, unknown> = { "ui-settings": record };
  return {
    async get() {
      return structuredClone(bag);
    },
    async set(next: Record<string, unknown>) {
      Object.assign(bag, structuredClone(next));
    },
  };
};

describe("UI settings — theme", () => {
  it("defaults to following the system, persists a choice and reads it back", async () => {
    const store = createUiSettingsStore(storedBag(undefined));
    expect(await store.load()).toMatchObject({ theme: "system" });
    await store.saveTheme("night");
    expect(await store.load()).toMatchObject({ theme: "night" });
    await store.saveTheme("paper");
    expect(await store.load()).toMatchObject({ theme: "paper" });
  });

  it("memory twin carries the same shapes", async () => {
    const store = createMemoryUiSettingsStore();
    expect(await store.load()).toMatchObject({ theme: "system" });
    await store.saveTheme("white");
    expect(await store.load()).toMatchObject({ theme: "white" });
  });
});

describe("UI settings — typography ladder (redesign 02)", () => {
  it("defaults to 1.15rem / 22% / 1.75 (照图:宽边距、1.75 行距)", async () => {
    const store = createUiSettingsStore(storedBag(undefined));
    expect(await store.load()).toEqual({
      theme: "system",
      typography: { fontStep: 1, marginStep: 2, lineStep: 1 },
    });
  });

  it("persists each ladder independently and reads them back", async () => {
    const store = createUiSettingsStore(storedBag(undefined));
    await store.saveTypography({ fontStep: 4 });
    expect(await store.load()).toMatchObject({
      typography: { fontStep: 4, marginStep: 2, lineStep: 1 },
    });
    await store.saveTypography({ marginStep: 0 });
    expect(await store.load()).toMatchObject({
      typography: { fontStep: 4, marginStep: 0, lineStep: 1 },
    });
    await store.saveTypography({ lineStep: 2 });
    expect(await store.load()).toMatchObject({
      typography: { fontStep: 4, marginStep: 0, lineStep: 2 },
    });
  });

  it("a version 2 theme record migrates keeping its theme, typography at default", async () => {
    const bag = storedBag({ version: 2, theme: "night" });
    const store = createUiSettingsStore(bag);
    expect(await store.load()).toEqual({
      theme: "night",
      typography: { fontStep: 1, marginStep: 2, lineStep: 1 },
    });
    await store.saveTypography({ fontStep: 0 });
    expect(bag.get()).resolves.toEqual({
      "ui-settings": {
        version: 3,
        theme: "night",
        typography: { fontStep: 0, marginStep: 2, lineStep: 1 },
      },
    });
  });

  it("out-of-range ladder values degrade to the default step", async () => {
    const store = createUiSettingsStore(
      storedBag({
        version: 3,
        theme: "white",
        typography: { fontStep: 9, marginStep: -1, lineStep: 99 },
      })
    );
    expect(await store.load()).toMatchObject({
      typography: { fontStep: 1, marginStep: 2, lineStep: 1 },
    });
  });

  it("memory twin carries the same typography shapes", async () => {
    const store = createMemoryUiSettingsStore();
    await store.saveTypography({ fontStep: 2 });
    expect(await store.load()).toMatchObject({
      typography: { fontStep: 2, marginStep: 2, lineStep: 1 },
    });
  });
});

describe("UI settings — version 1 migration", () => {
  it("a version 1 pdfToolbar record loads as the defaults without losing the record", async () => {
    const bag = storedBag({ version: 1, pdfToolbar: "bottom" });
    const store = createUiSettingsStore(bag);
    // 不炸: the old record reads as a valid settings object…
    expect(await store.load()).toMatchObject({ theme: "system" });
    // 不丢: the next save rewrites it as the current record version
    // (3 since redesign 02's typography ladder) — the retired
    // pdfToolbar item never resurfaces.
    await store.saveTheme("night");
    await expect(bag.get()).resolves.toEqual({
      "ui-settings": {
        version: 3,
        theme: "night",
        typography: { fontStep: 1, marginStep: 2, lineStep: 1 },
      },
    });
    expect(await store.load()).toMatchObject({ theme: "night" });
  });

  it("degrades malformed or unknown records to the default without overwriting", async () => {
    const bag = storedBag({ version: 99, pdfToolbar: "bottom" });
    const store = createUiSettingsStore(bag);
    // Malformed record reads as the default…
    expect(await store.load()).toMatchObject({ theme: "system" });
    // …and the next save replaces it with a valid record.
    await store.saveTheme("white");
    await expect(bag.get()).resolves.toEqual({
      "ui-settings": {
        version: 3,
        theme: "white",
        typography: { fontStep: 1, marginStep: 2, lineStep: 1 },
      },
    });
  });

  it("a version 2 record with an unknown theme value falls back to the default", async () => {
    const store = createUiSettingsStore(
      storedBag({ version: 2, theme: "sepia" })
    );
    expect(await store.load()).toMatchObject({ theme: "system" });
  });
});
