import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { App } from "../src/App";

// 空壳验收面(票 01):启动即落在书架占位路由 —— 应用名可见、
// 书架入口可见、空态提示可见。真书架接线(02)在此断言面上换装,
// 组件内部怎么排版本测试不关心。
test("空壳启动落在书架:应用名、书架标题与空态提示可见", () => {
  render(<App />);
  expect(
    screen.getByRole("heading", { level: 1, name: "LinguaLeaf" })
  ).toBeVisible();
  expect(screen.getByRole("heading", { level: 2, name: "书架" })).toBeVisible();
  expect(screen.getByText("还没有书，先导入一本吧。")).toBeVisible();
});
