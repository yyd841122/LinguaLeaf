import { describe, expect, it } from "vitest";
import {
  DEFAULT_TRANSLATE_SETTINGS,
  createMemoryTranslateSettingsStore,
  createTranslateSettingsStore,
  isConfigured,
} from "../src/store/translate-settings-store";

describe("TranslateSettingsStore", () => {
  it("reads the DeepSeek defaults when nothing was saved yet", async () => {
    const store = createMemoryTranslateSettingsStore();
    expect(await store.load()).toEqual({
      apiKey: "",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-flash",
    });
    expect(DEFAULT_TRANSLATE_SETTINGS.baseUrl).toBe("https://api.deepseek.com");
    expect(DEFAULT_TRANSLATE_SETTINGS.model).toBe("deepseek-flash");
  });

  it("saves the runtime key, base URL and model and reads them back", async () => {
    const store = createMemoryTranslateSettingsStore();
    await store.save({
      apiKey: "sk-mine",
      baseUrl: "http://127.0.0.1:3917",
      model: "deepseek-reasoner",
    });
    expect(await store.load()).toEqual({
      apiKey: "sk-mine",
      baseUrl: "http://127.0.0.1:3917",
      model: "deepseek-reasoner",
    });
  });

  it("survives a backend that hands back cloned records", async () => {
    const backing = new Map<string, unknown>();
    const store = createTranslateSettingsStore({
      async get(namespace) {
        const snapshot = structuredClone(backing.get(namespace));
        return snapshot === undefined ? {} : { [namespace]: snapshot };
      },
      async set(bag) {
        for (const [key, value] of Object.entries(bag))
          backing.set(key, structuredClone(value));
      },
    });
    await store.save({
      apiKey: "sk-x",
      baseUrl: "https://relay.example.com/v1",
      model: "deepseek-flash",
    });
    expect(await store.load()).toEqual({
      apiKey: "sk-x",
      baseUrl: "https://relay.example.com/v1",
      model: "deepseek-flash",
    });
  });

  it("isConfigured reads only the key", () => {
    expect(isConfigured({ apiKey: "", baseUrl: "", model: "" })).toBe(false);
    expect(isConfigured({ apiKey: "  ", baseUrl: "x", model: "y" })).toBe(
      false
    );
    expect(isConfigured({ apiKey: "sk-1", baseUrl: "", model: "" })).toBe(true);
  });
});
