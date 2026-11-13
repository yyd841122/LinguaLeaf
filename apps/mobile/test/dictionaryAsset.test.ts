// mobile-app 02 收官审核变异 c 的 catcher:mobile 资产 = extension 烘料
// 产物的逐字节复用,字节同一就是这两份文件的契约;.prettierignore 的两条
// 目挡住 commit 钩子的 rewrap(2026-11-09 实证过 14,943,187 → 18,310,286
// 的假漂移)。任一半失守,本套件红。
// 两份烘料资产是 gitignored 的本地产物(烘焙自服务端 sqlite),CI
// checkout 上天然不存在——字节同一套件在资产缺失时整组跳过(skip 名单
// 可见,不冒充通过),.prettierignore 契约测试无条件跑(pin 的是已入库
// 文件)。读取用 vite 的 ?raw 导入:mobile 测试块禁 Node 全局
// (process/Buffer),jsdom 又会重写 import.meta.url(?raw 在 transform
// 期内联,两个坑都绕开);资产缺失的探活走动态导入,失败即 skip 信号。
import prettierIgnore from "../../../.prettierignore?raw";
import { describe, expect, it } from "vitest";

async function tryRaw(
  importer: () => Promise<{ default: string }>
): Promise<string | null> {
  try {
    return (await importer()).default;
  } catch {
    return null; // 烘料资产不在(CI / 未烘焙)——调用方 skip,不冒充断言
  }
}

const mobileDict = await tryRaw(() => import("../public/dictionary.json?raw"));
const extensionDict = await tryRaw(
  () => import("../../extension/public/dictionary.json?raw")
);

describe("dictionary asset .prettierignore pin (rewrap 防线)", () => {
  it("两份资产都在 .prettierignore 的 rewrap 保护清单里", () => {
    expect(prettierIgnore).toContain("apps/extension/public/dictionary.json");
    expect(prettierIgnore).toContain("apps/mobile/public/dictionary.json");
  });
});

describe.skipIf(mobileDict === null || extensionDict === null)(
  "dictionary asset byte identity (烘料复用契约;资产缺失即跳过)",
  () => {
    it("mobile 副本与 extension 烘料逐字节同一", () => {
      expect(mobileDict!.length).toBe(extensionDict!.length);
      expect(mobileDict).toBe(extensionDict);
    });
  }
);
