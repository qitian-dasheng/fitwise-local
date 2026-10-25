import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FoodPage } from "../src/pages/FoodPage";
import { initialState } from "../src/domain/seed";
import { diaryToday } from "../src/domain/diary";
import { useAppStore } from "../src/store/appStore";
import { useFoodPicker } from "../src/store/foodPicker";

let container: HTMLDivElement;
let root: Root;
const originalRecord = useAppStore.getState().recordFoodMeal;

beforeEach(async () => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  useAppStore.setState({ ...structuredClone(initialState), recordFoodMeal: originalRecord });
  useFoodPicker.setState({ basket: [], editorTarget: null, returnTicket: null });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<FoodPage date={diaryToday()} />));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

const button = (text: string) => {
  const element = [...container.querySelectorAll("button")].find((item) => item.textContent?.includes(text));
  if (!element) throw new Error(`Missing button ${text}`);
  return element;
};
async function click(text: string) { await act(async () => button(text).click()); }
const inputIn = (scope: Element, label: string) => {
  const element = [...scope.querySelectorAll("label")].find((item) => item.textContent?.includes(label))?.querySelector("input");
  if (!element) throw new Error(`Missing input ${label}`);
  return element as HTMLInputElement;
};
async function fill(element: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** 走完整链路：弹窗建档 400kcal/12g 食物 → 50g 与 25g 两次加入篮子 → 关闭弹窗。 */
async function addTwoEntries() {
  await click("添加食物");
  const modal = container.querySelector(".food-library")!;
  await click("新建食物");
  await fill(inputIn(modal, "食物名称"), "原味燕麦");
  await fill(inputIn(modal, "能量（"), "400");
  await fill(inputIn(modal, "蛋白质（"), "12");
  await fill(inputIn(modal, "脂肪（"), "0");
  await act(async () => [...modal.querySelectorAll("input")].find((item) => item.closest("label")?.textContent?.includes("我已核对"))!.click());
  await act(async () => modal.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  await fill(container.querySelector<HTMLInputElement>('[aria-label="摄入数量"]')!, "50");
  await click("加入本餐");
  await fill(container.querySelector<HTMLInputElement>('[aria-label="摄入数量"]')!, "25");
  await click("加入本餐");
  // 关弹窗（X 为图标按钮，走 aria-label）。
  await act(async () => container.querySelector<HTMLButtonElement>('.modal [aria-label="关闭"]')!.click());
}

it("keeps the bar hidden while the basket is empty and shows one collapsed row after adding", async () => {
  expect(container.querySelector(".basket-bar")).toBeNull();
  await addTwoEntries();
  const bar = container.querySelector(".basket-bar")!;
  expect(bar.textContent).toContain("待确认篮子 · 2 项");
  expect(bar.textContent).toContain("300"); // 50g=200 + 25g=100
  // 收起态：明细与日期/餐次不渲染，页面保持一屏。
  expect(bar.querySelector('[aria-label="本批营养合计"]')).toBeNull();
  expect(bar.querySelector('input[type="date"]')).toBeNull();
});

it("expands for in-place quantity edits and records the whole basket in one transaction", async () => {
  const record = vi.fn(originalRecord);
  await act(async () => useAppStore.setState({ recordFoodMeal: record }));
  await addTwoEntries();
  await click("展开核对");
  // 50g=200kcal/6g 蛋白 + 25g=100kcal/3g 蛋白 → 300 kcal / 9 g；纤维未知，不得按 0 显示。
  const summary = container.querySelector('[aria-label="本批营养合计"]')!;
  expect(summary.textContent).toContain("300");
  expect(summary.textContent).toContain("9");
  expect(summary.textContent).toContain("未知");
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="修改原味燕麦数量"]')!.click());
  await fill(container.querySelector<HTMLInputElement>('[aria-label="修改原味燕麦的数量"]')!, "100");
  expect(container.querySelector('[aria-label="本批营养合计"]')!.textContent).toContain("500");
  await click("确认写入 2 项");
  expect(useAppStore.getState().meals.map((item) => item.nutrition.calories.value)).toEqual([400, 100]);
  // 写入成功后篮子清空、条目隐藏。
  expect(useFoodPicker.getState().basket).toHaveLength(0);
  expect(container.querySelector(".basket-bar")).toBeNull();
  expect(record).toHaveBeenCalledTimes(1);
});

it("keeps the basket and retries with the same command ID after a save failure", async () => {
  await addTwoEntries();
  const record = vi.fn(originalRecord).mockResolvedValueOnce({ error: "记录保存失败" });
  await act(async () => useAppStore.setState({ recordFoodMeal: record }));
  await click("确认写入 2 项");
  expect(container.textContent).toContain("记录保存失败");
  expect(container.textContent).toContain("待确认篮子 · 2 项");
  expect(useAppStore.getState().meals).toHaveLength(0);
  await click("确认写入 2 项");
  expect(record.mock.calls[0][1]).toBe(record.mock.calls[1][1]);
  expect(useAppStore.getState().meals.map((item) => item.nutrition.calories.value)).toEqual([200, 100]);
  expect(container.querySelector(".basket-bar")).toBeNull();
});

it("lets entries be removed from the expanded basket", async () => {
  await addTwoEntries();
  await click("展开核对");
  // 两次加入同名食物：先移除一个（剩 1 项），再移除后整条隐藏。
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="移除原味燕麦"]')!.click());
  expect(useFoodPicker.getState().basket).toHaveLength(1);
  expect(container.textContent).toContain("待确认篮子 · 1 项");
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="移除原味燕麦"]')!.click());
  expect(useFoodPicker.getState().basket).toHaveLength(0);
  expect(container.querySelector(".basket-bar")).toBeNull();
});
