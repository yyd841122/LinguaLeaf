// 真机「保存到本机」必败的病根(2026-11-16 独立终审 P1,save-to-downloads-
// unregistered 票):自定义 Capacitor 插件必须在 MainActivity 注册,JS 的
// registerPlugin 代理才会落到原生实现——漏注册不炸构建、不炸单测,只有真机
// 按下去才报「未实现」,memory adapter 测试永远够不到这条路径。本门双向钉住:
// JS 侧每个注册名 ↔ 原生侧一个 @CapacitorPlugin 类 ↔ MainActivity 一行
// registerPlugin。官方插件(Filesystem/Share)走自动注册,不在本门范围。
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Path anchors go through fileURLToPath+resolve — jsdom 的全局 URL 会把
// 相对路径解析到 document base(dictionaryAsset.test.ts 同款注释)。
const here = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(here, "../src");
const JAVA_APP_DIR = resolve(
  here,
  "../android/app/src/main/java/dev/lingualeaf/app"
);

// JS 侧自定义插件注册名:registerPlugin<...>("Name")。
const jsPluginNames = new Set<string>();
const walkTs = (dir: string): void => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walkTs(path);
    else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      const text = readFileSync(path, "utf8");
      for (const match of text.matchAll(
        /registerPlugin(?:<[^>]*>)?\(\s*"([^"]+)"/g
      )) {
        jsPluginNames.add(match[1]!);
      }
    }
  }
};
walkTs(SRC);

// 原生侧:@CapacitorPlugin(name = "X") 类清单。
const annotatedClasses = new Map<string, string>();
for (const file of readdirSync(JAVA_APP_DIR)) {
  if (!file.endsWith(".java")) continue;
  const text = readFileSync(join(JAVA_APP_DIR, file), "utf8");
  const match = /@CapacitorPlugin\(name = "([^"]+)"\)/.exec(text);
  if (match) annotatedClasses.set(match[1]!, file.replace(/\.java$/, ""));
}

const mainActivity = readFileSync(
  join(JAVA_APP_DIR, "MainActivity.java"),
  "utf8"
);

describe("native plugin registration gate (真机插件未实现防线)", () => {
  it("every JS registerPlugin name has a @CapacitorPlugin native class", () => {
    expect([...jsPluginNames].sort()).toEqual(
      [...annotatedClasses.keys()].sort()
    );
  });

  it("every @CapacitorPlugin class is registered in MainActivity", () => {
    for (const [name, className] of annotatedClasses) {
      expect(
        mainActivity,
        `${className}(${name}) 未在 MainActivity 注册——真机调用会报未实现`
      ).toContain(`registerPlugin(${className}.class)`);
    }
  });
});
