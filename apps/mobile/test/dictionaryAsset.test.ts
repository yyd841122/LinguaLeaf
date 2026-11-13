// mobile-app 02 收官审核变异 c 的 catcher:mobile 资产 = extension 烘料
// 产物的逐字节复用,字节同一就是这两份文件的契约;.prettierignore 的两条
// 目挡住 commit 钩子的 rewrap(2026-11-09 实证过 14,943,187 → 18,310,286
// 的假漂移)。任一半失守,本套件红。
// 两份烘料资产是 gitignored 的本地产物(烘焙自服务端 sqlite),CI
// checkout 上天然不存在——字节同一套件在资产缺席时整组跳过(skip 名单
// 可见,不冒充通过);.prettierignore 契约测试无条件跑(pin 的是已入库
// 文件)。读取不用 vite 的 ?raw:动态导入的字面量在 transform 期仍被
// import-analysis 静态解析(2026-11-13 CI 实证),缺席即整文件红;测试
// 文件本身跑在 Node 侧,node:fs 直读既绕开解析、又能先探活再跳过
// (readerPage.test 等已有 fs 先例)。
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import prettierIgnore from "../../../.prettierignore?raw";
import { describe, expect, it } from "vitest";

// Path anchors go through fileURLToPath+resolve, NOT new URL(relative,
// import.meta.url): under the jsdom environment the global URL is
// jsdom's, and it resolves the relative against the document base
// (http://localhost:3000) ignoring the file base — readerPage.test.tsx's
// identical pattern.
const here = dirname(fileURLToPath(import.meta.url));
const mobileDictPath = resolve(here, "../public/dictionary.json");
const extensionDictPath = resolve(
  here,
  "../../extension/public/dictionary.json"
);
const assetsPresent =
  existsSync(mobileDictPath) && existsSync(extensionDictPath);

describe("dictionary asset .prettierignore pin (rewrap 防线)", () => {
  it("两份资产都在 .prettierignore 的 rewrap 保护清单里", () => {
    expect(prettierIgnore).toContain("apps/extension/public/dictionary.json");
    expect(prettierIgnore).toContain("apps/mobile/public/dictionary.json");
  });
});

describe.skipIf(!assetsPresent)(
  "dictionary asset byte identity (烘料复用契约;资产缺失即跳过)",
  () => {
    it("mobile 副本与 extension 烘料逐字节同一", () => {
      const mobileDict = readFileSync(mobileDictPath, "utf8");
      const extensionDict = readFileSync(extensionDictPath, "utf8");
      expect(mobileDict.length).toBe(extensionDict.length);
      expect(mobileDict).toBe(extensionDict);
    });
  }
);
