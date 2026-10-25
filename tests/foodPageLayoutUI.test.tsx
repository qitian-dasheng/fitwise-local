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
  // 0.9.4 第三轮：菜谱收进页头小按钮（同食材库按钮样式），点击开管理抽屉。
  expect(host.querySelector(".kitchen-strip")).toBeNull();
  expect(host.querySelector(".two-column")).toBeNull();
  expect(host.querySelector(".validation-card")).toBeNull();

  const recipeBtn = host.querySelector(".food-recipe-btn") as HTMLButtonElement;
  expect(recipeBtn).not.toBeNull();
  // 第四轮：按钮只留「菜谱」二字，菜名收进抽屉。
  expect(recipeBtn.textContent?.trim()).toBe("菜谱");
});

it("keeps recipe management inside a drawer that closes on Escape", async () => {
  await act(async () => root.render(<FoodPage />));

  for (const label of ["新建菜谱", "修订当前菜谱", "另存为新菜谱"]) {
    expect([...host.querySelectorAll("button")].some((b) => b.textContent?.trim() === label)).toBe(false);
  }
  expect(host.querySelector('select[aria-label="选择标准菜谱"]')).toBeNull();

  await act(async () => (host.querySelector(".food-recipe-btn") as HTMLButtonElement).click());
  const drawer = host.querySelector(".drawer")!;
  expect(drawer).not.toBeNull();
  expect(drawer.getAttribute("aria-modal")).toBe("true");
  expect(drawer.querySelector('.recipe-list')).not.toBeNull();
  expect([...drawer.querySelectorAll("button")].some((b) => b.textContent?.trim() === "新建菜谱")).toBe(true);

  await act(async () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  });
  expect(host.querySelector(".drawer")).toBeNull();
  // 抽屉关闭后页头菜谱按钮仍在（选择状态由抽屉内部保留，按钮只留「菜谱」二字）。
  expect(host.querySelector(".food-recipe-btn")!.textContent?.trim()).toBe("菜谱");
});

it("collapses the drawer before opening the recipe editor so only one overlay is visible", async () => {
  await act(async () => root.render(<FoodPage />));
  await act(async () => (host.querySelector(".food-recipe-btn") as HTMLButtonElement).click());
  expect(host.querySelector(".drawer")).not.toBeNull();

  await act(async () => button("新建菜谱").click());
  expect(host.querySelector(".drawer")).toBeNull();
  expect(host.querySelector(".modal-backdrop")).not.toBeNull();
});
