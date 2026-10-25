import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FoodPage } from "../src/pages/FoodPage";
import { initialState } from "../src/domain/seed";
import { useAppStore } from "../src/store/appStore";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  useAppStore.setState(structuredClone(initialState));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

const button = (label: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === label)!;

it("renders the cooking card as a single compact row (0.9.4 压一行)", async () => {
  await act(async () => root.render(<FoodPage />));

  expect(host.querySelector(".food-page")).not.toBeNull();
  // 0.9.4 第二轮：菜谱行上移为页头正下方细条。
  const workbench = host.querySelector(".kitchen-strip")!;
  expect(workbench).not.toBeNull();
  expect(host.querySelector(".two-column")).toBeNull();
  expect(host.querySelector(".validation-card")).toBeNull();

  // 一行入口：菜名 + 热量/蛋白/时长摘要 + 两个动作按钮；不再有大图标块、三格宏量与食材清单。
  const kitchen = workbench.querySelector(".kitchen-card")!;
  expect(kitchen.querySelector(".kitchen-row")).not.toBeNull();
  expect(kitchen.textContent).toContain(initialState.recipes[0].name);
  expect(kitchen.textContent).toContain("kcal");
  expect(kitchen.querySelector(".recipe-macros")).toBeNull();
  expect(kitchen.querySelector(".ingredient-list")).toBeNull();
  expect(kitchen.querySelector(".kitchen-footnote")).toBeNull();
  expect([...kitchen.querySelectorAll("button")].map((b) => b.textContent?.trim())).toContain("加入餐次");
  expect([...kitchen.querySelectorAll("button")].map((b) => b.textContent?.trim())).toContain("管理菜谱");
});

it("keeps recipe management inside a drawer that closes on Escape", async () => {
  await act(async () => root.render(<FoodPage />));

  for (const label of ["新建菜谱", "修订当前菜谱", "另存为新菜谱"]) {
    expect([...host.querySelectorAll("button")].some((b) => b.textContent?.trim() === label)).toBe(false);
  }
  expect(host.querySelector('select[aria-label="选择标准菜谱"]')).toBeNull();

  await act(async () => button("管理菜谱").click());
  const drawer = host.querySelector(".drawer")!;
  expect(drawer).not.toBeNull();
  expect(drawer.getAttribute("aria-modal")).toBe("true");
  expect(drawer.querySelector('select[aria-label="选择标准菜谱"]')).not.toBeNull();
  expect([...drawer.querySelectorAll("button")].some((b) => b.textContent?.trim() === "新建菜谱")).toBe(true);

  await act(async () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  });
  expect(host.querySelector(".drawer")).toBeNull();
  // 抽屉关闭后厨房卡仍在，选择结果保留在主页面上。
  expect(host.querySelector(".kitchen-card")!.textContent).toContain(initialState.recipes[0].name);
});

it("collapses the drawer before opening the recipe editor so only one overlay is visible", async () => {
  await act(async () => root.render(<FoodPage />));
  await act(async () => button("管理菜谱").click());
  expect(host.querySelector(".drawer")).not.toBeNull();

  await act(async () => button("新建菜谱").click());
  expect(host.querySelector(".drawer")).toBeNull();
  expect(host.querySelector(".modal-backdrop")).not.toBeNull();
});
