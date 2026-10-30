import { describe, expect, it } from "vitest";
import { reconcilePermissions } from "../scripts/check-manifest-permissions.mjs";

const file = (path: string, text: string) => ({ path, text });

// Pins the gate's semantics (audit 2026-10-30 findings #2/#3): usage comes
// from the AST only — comments and strings never count, computed string
// access does — and anything a static rule cannot decide fails loudly
// instead of passing silently.
describe("reconcilePermissions", () => {
  it("accepts a namespace that is declared", () => {
    const { offenders } = reconcilePermissions({
      manifest: { permissions: ["storage"] },
      files: [file("src/a.ts", "chrome.storage.local.get('k', () => {});")],
    });
    expect(offenders).toEqual([]);
  });

  it("flags a used namespace that is not declared", () => {
    const { offenders } = reconcilePermissions({
      manifest: { permissions: ["storage"] },
      files: [file("src/a.ts", "chrome.downloads.download({ url: 'x' });")],
    });
    expect(offenders).toEqual([
      'chrome.downloads used in src/a.ts but "downloads" is not in manifest permissions',
      'manifest declares "storage" but no src file uses chrome.storage',
    ]);
  });

  it("flags a declared permission nothing uses", () => {
    const { offenders } = reconcilePermissions({
      manifest: { permissions: ["storage", "downloads"] },
      files: [file("src/a.ts", "chrome.storage.local.get('k', () => {});")],
    });
    expect(offenders).toEqual([
      'manifest declares "downloads" but no src file uses chrome.downloads',
    ]);
  });

  it("does not demand declarations for permission-free namespaces", () => {
    const { offenders } = reconcilePermissions({
      manifest: { permissions: [] },
      files: [file("src/a.ts", "chrome.runtime.sendMessage('x');")],
    });
    expect(offenders).toEqual([]);
  });

  it("ignores chrome.* mentions inside comments and strings", () => {
    const { offenders } = reconcilePermissions({
      manifest: { permissions: [] },
      files: [
        file(
          "src/a.ts",
          [
            "// chrome.downloads.download({ url: 'x' });",
            'const hint = "chrome.downloads";',
            "/* chrome.downloads */",
          ].join("\n")
        ),
      ],
    });
    expect(offenders).toEqual([]);
  });

  it('counts string-literal computed access, chrome["downloads"]', () => {
    const { offenders } = reconcilePermissions({
      manifest: { permissions: ["downloads"] },
      files: [file("src/a.tsx", 'chrome["downloads"].download({ url: "x" });')],
    });
    expect(offenders).toEqual([]);
  });

  it("counts window.chrome.<ns> usage on its own", () => {
    const { offenders } = reconcilePermissions({
      manifest: { permissions: ["tabs"] },
      files: [file("src/a.ts", "window.chrome.tabs.query({});")],
    });
    expect(offenders).toEqual([]);
  });

  it("counts chrome?.<ns> optional-chain usage on its own", () => {
    const { offenders } = reconcilePermissions({
      manifest: { permissions: [] },
      files: [file("src/a.ts", "chrome?.tabs.query({});")],
    });
    expect(offenders.some((line) => line.includes("chrome.tabs.query"))).toBe(
      true
    );
  });

  it("does not flag host-pattern permissions as unused", () => {
    const { offenders } = reconcilePermissions({
      manifest: { permissions: ["storage", "http://*/*"] },
      files: [file("src/a.ts", "chrome.storage.local.get('k', () => {});")],
    });
    expect(offenders).toEqual([]);
  });

  it("rejects alias bindings of the chrome handle", () => {
    const { offenders } = reconcilePermissions({
      manifest: { permissions: [] },
      files: [file("src/a.ts", "const c = chrome;\nc.downloads.download({});")],
    });
    expect(
      offenders.some((line) => line.includes("aliased chrome usage"))
    ).toBe(true);
  });

  it("rejects non-literal computed access on chrome", () => {
    const { offenders } = reconcilePermissions({
      manifest: { permissions: [] },
      files: [
        file(
          "src/a.ts",
          "const ns = 'storage';\nchrome[ns].local.get('k', () => {});"
        ),
      ],
    });
    expect(offenders.some((line) => line.includes("computed access"))).toBe(
      true
    );
  });

  it("rejects destructuring bindings of the chrome handle", () => {
    const { offenders } = reconcilePermissions({
      manifest: { permissions: [] },
      files: [
        file(
          "src/a.ts",
          "const { storage } = chrome;\nstorage.local.get('x');"
        ),
      ],
    });
    expect(
      offenders.some((line) => line.includes("aliased chrome usage"))
    ).toBe(true);
  });

  it("ignores unrelated .chrome. chains that are not the extension API", () => {
    const { offenders } = reconcilePermissions({
      manifest: { permissions: [] },
      files: [
        file("src/a.ts", "other.chrome.storage.local.get('x', () => {});"),
      ],
    });
    expect(offenders).toEqual([]);
  });

  it("rejects destructuring assignment of the chrome handle", () => {
    const { offenders } = reconcilePermissions({
      manifest: { permissions: [] },
      files: [file("src/a.ts", "({ storage } = chrome);")],
    });
    expect(
      offenders.some((line) => line.includes("aliased chrome usage"))
    ).toBe(true);
  });

  it("does not reject bindings of unrelated .chrome. chains", () => {
    const { offenders } = reconcilePermissions({
      manifest: { permissions: [] },
      files: [file("src/a.ts", "const x = other.chrome.storage;")],
    });
    expect(offenders).toEqual([]);
  });

  it("does not count chrome hanging off a non-global .window", () => {
    const { offenders } = reconcilePermissions({
      manifest: { permissions: [] },
      files: [
        file(
          "src/a.ts",
          "other.window.chrome.storage.local.get('x', () => {});"
        ),
      ],
    });
    expect(offenders).toEqual([]);
  });

  it("rejects spread members of a destructuring assignment", () => {
    const { offenders } = reconcilePermissions({
      manifest: { permissions: [] },
      files: [file("src/a.ts", "({ ...rest } = chrome);")],
    });
    expect(
      offenders.some((line) => line.includes("aliased chrome usage"))
    ).toBe(true);
  });

  it("rejects computed keys in a destructuring assignment", () => {
    const { offenders } = reconcilePermissions({
      manifest: { permissions: [] },
      files: [file("src/a.ts", "({ [key]: v } = chrome);")],
    });
    expect(
      offenders.some((line) => line.includes("aliased chrome usage"))
    ).toBe(true);
  });

  it("lets a mapped permission-free operation through: tabs.sendMessage", () => {
    const { offenders } = reconcilePermissions({
      manifest: { permissions: [] },
      files: [file("src/a.ts", "chrome.tabs.sendMessage(1, 'x');")],
    });
    expect(offenders).toEqual([]);
  });

  it("keeps tabs.query requiring the tabs permission", () => {
    const { offenders } = reconcilePermissions({
      manifest: { permissions: [] },
      files: [file("src/a.ts", "chrome.tabs.query({});")],
    });
    expect(offenders).toEqual([
      "chrome.tabs.query used in src/a.ts but its requirements tabs are not met by manifest permissions",
    ]);
  });

  it("does not trip on Object.prototype names used as operations", () => {
    const { offenders } = reconcilePermissions({
      manifest: { permissions: [] },
      files: [file("src/a.ts", "chrome.tabs.valueOf();")],
    });
    expect(offenders).toEqual([
      'chrome.tabs used in src/a.ts but "tabs" is not in manifest permissions',
    ]);
  });

  it("demands host access for scripting.executeScript", () => {
    const { offenders: onlyScripting } = reconcilePermissions({
      manifest: { permissions: ["scripting"] },
      files: [file("src/a.ts", "chrome.scripting.executeScript({});")],
    });
    expect(onlyScripting).toEqual([
      "chrome.scripting.executeScript used in src/a.ts but its requirements [activeTab | hostAccess] are not met by manifest permissions",
    ]);
    for (const extra of ["activeTab", "http://*/*", "<all_urls>"]) {
      const { offenders } = reconcilePermissions({
        manifest: { permissions: ["scripting", extra] },
        files: [file("src/a.ts", "chrome.scripting.executeScript({});")],
      });
      expect(offenders).toEqual([]);
    }
  });
});
