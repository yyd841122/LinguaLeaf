// mobile-app 02 收官审核变异 c 的 catcher:mobile 资产 = extension 烘料
// 产物的逐字节复用,字节同一就是这两份文件的契约;.prettierignore 的两条
// 目挡住 commit 钩子的 rewrap(2026-11-09 实证过 14,943,187 → 18,310,286
// 的假漂移)。任一半失守,本套件红。
// 读取用 vite 的 ?raw 导入:mobile 测试块禁 Node 全局(process/Buffer),
// jsdom 又会重写 import.meta.url(?raw 在 transform 期内联,两个坑都绕开)。
import mobileDict from "../public/dictionary.json?raw";
import extensionDict from "../../extension/public/dictionary.json?raw";
import prettierIgnore from "../../../.prettierignore?raw";
import { describe, expect, it } from "vitest";

describe("dictionary asset byte identity (烘料复用契约)", () => {
  it("mobile 副本与 extension 烘料逐字节同一", () => {
    expect(mobileDict.length).toBe(extensionDict.length);
    expect(mobileDict).toBe(extensionDict);
  });

  it("两份资产都在 .prettierignore 的 rewrap 保护清单里", () => {
    expect(prettierIgnore).toContain("apps/extension/public/dictionary.json");
    expect(prettierIgnore).toContain("apps/mobile/public/dictionary.json");
  });
});
