import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TranslateSettings } from "../src/translate/TranslateSettings";
import {
  DEFAULT_TRANSLATE_SETTINGS,
  createMemoryTranslateSettingsStore,
} from "../src/store/translate-settings-store";

// The settings page (mobile-app ticket 04, ADR-0008): key / BASE_URL /
// MODEL are runtime facts, stored app-local, never compiled into the APK.
// The form loads what is stored, saves trimmed values, and carries the
// OpenAI-compatibility hint — a /anthropic-suffix endpoint is the one
// misconfiguration this app has already paid for once (server-side排障
// memory), so the guard is copy at the field.

describe("TranslateSettings", () => {
  it("loads the stored settings into the fields", async () => {
    const store = createMemoryTranslateSettingsStore();
    await store.save({
      apiKey: "sk-mine",
      baseUrl: "http://127.0.0.1:3917",
      model: "deepseek-reasoner",
    });
    render(<TranslateSettings store={store} onClose={() => undefined} />);

    await waitFor(() =>
      expect((screen.getByLabelText("API Key") as HTMLInputElement).value).toBe(
        "sk-mine"
      )
    );
    expect((screen.getByLabelText(/接口地址/) as HTMLInputElement).value).toBe(
      "http://127.0.0.1:3917"
    );
    expect((screen.getByLabelText(/模型/) as HTMLInputElement).value).toBe(
      "deepseek-reasoner"
    );
  });

  it("saves trimmed values and confirms, empty address and model fall back to defaults", async () => {
    const store = createMemoryTranslateSettingsStore();
    render(<TranslateSettings store={store} onClose={() => undefined} />);

    await waitFor(() =>
      expect((screen.getByLabelText("API Key") as HTMLInputElement).value).toBe(
        ""
      )
    );
    fireEvent.change(screen.getByLabelText("API Key"), {
      target: { value: "  sk-new  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toBe("已保存")
    );
    expect(await store.load()).toEqual({
      apiKey: "sk-new",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-flash",
    });
  });

  it("rejects a base URL without a scheme and does not save", async () => {
    const store = createMemoryTranslateSettingsStore();
    render(<TranslateSettings store={store} onClose={() => undefined} />);

    await waitFor(() =>
      expect((screen.getByLabelText("API Key") as HTMLInputElement).value).toBe(
        ""
      )
    );
    fireEvent.change(screen.getByLabelText(/接口地址/), {
      target: { value: "api.deepseek.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    expect(screen.getByRole("alert").textContent).toContain(
      "接口地址需以 http"
    );
    expect(await store.load()).toEqual(DEFAULT_TRANSLATE_SETTINGS);
  });

  it("carries the OpenAI-compatibility hint at the address field", async () => {
    const store = createMemoryTranslateSettingsStore();
    render(<TranslateSettings store={store} onClose={() => undefined} />);
    expect((await screen.findByText(/anthropic/)).textContent).toContain(
      "OpenAI 兼容"
    );
  });
});
