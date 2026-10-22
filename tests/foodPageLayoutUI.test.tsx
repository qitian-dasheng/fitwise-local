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

it("lays out the cooking card and its footnote without a separate hint card", async () => {
  await act(async () => root.render(<FoodPage />));

  expect(host.querySelector(".food-page")).not.toBeNull();
  const workbench = host.querySelector(".food-workbench")!;
  expect(workbench).not.toBeNull();
  expect(host.querySelector(".two-column")).toBeNull();
  expect(host.querySelector(".validation-card")).toBeNull();

  const kitchen = workbench.querySelector(".kitchen-card")!;
  expect(kitchen.textContent).toContain("今日下厨");
  expect(kitchen.textContent).toContain(initialState.recipes[0].name);

  // 说明文案降级为厨房卡脚注，不再单独占一张卡。
  const footnote = kitchen.querySelector(".kitchen-footnote")!;
  expect(footnote.textContent).toContain("营养值不会把空白当成零");
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
