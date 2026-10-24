import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FoodLibraryModal } from "../src/components/FoodLibraryModal";
import { initialState } from "../src/domain/seed";
import { useAppStore } from "../src/store/appStore";

let container: HTMLDivElement;
let root: Root;
const closed = vi.fn();
const manual = vi.fn();
const originalSave = useAppStore.getState().saveFoodDefinition;
const originalRecord = useAppStore.getState().recordFoodMeal;
beforeEach(async () => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  useAppStore.setState({ ...structuredClone(initialState), saveFoodDefinition: originalSave, recordFoodMeal: originalRecord });
  container = document.createElement("div"); document.body.append(container);
  root = createRoot(container);
  closed.mockReset(); manual.mockReset();
  await act(async () => { root.render(<FoodLibraryModal onClose={closed} onManual={manual} initialType="lunch"/>); });
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); });

function button(text: string) {
  const element = [...container.querySelectorAll("button")].find((item) => item.textContent?.includes(text));
  if (!element) throw new Error(`Missing button ${text}`);
  return element;
}
async function click(text: string) { await act(async () => button(text).click()); }
function input(label: string) {
  const element = [...container.querySelectorAll("label")].find((item) => item.textContent?.includes(label))?.querySelector("input");
  if (!element) throw new Error(`Missing input ${label}`);
  return element;
}
async function fill(element: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function enterFood() {
  await click("新建食物");
  await fill(input("食物名称"), "原味燕麦");
  await fill(input("能量（"), "400");
  await fill(input("蛋白质（"), "12");
  await fill(input("脂肪（"), "0");
  await act(async () => input("我已核对").click());
}
async function submit() { await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))); }

it("creates once, previews 50 g and records only after confirming the basket", async () => {
  expect(container.textContent).toContain("从食材库记录饮食");
  await enterFood();
  await submit();
  expect(useAppStore.getState().foodDefinitions).toHaveLength(1);
  expect(useAppStore.getState().meals).toHaveLength(0);
  await fill(container.querySelector<HTMLInputElement>('[aria-label="摄入数量"]')!, "50");
  const preview = container.querySelector('[aria-label="本次营养换算"]')!;
  expect(preview.textContent).toContain("200 kcal");
  expect(preview.textContent).toContain("6 g");
  expect(preview.textContent).toContain("未知");
  await click("加入本餐");
  expect(useAppStore.getState().meals).toHaveLength(0);
  await click("确认写入 1 项食物");
  expect(useAppStore.getState().meals[0]).toMatchObject({ type: "lunch", nutrition: { calories: { value: 200 }, protein: { value: 6 } } });
  expect(closed).toHaveBeenCalledTimes(1);
});

it("retains inputs and retries with the same command ID after save failure", async () => {
  await enterFood();
  const original = useAppStore.getState().saveFoodDefinition;
  const save = vi.fn(original).mockResolvedValueOnce({ error: "数据库暂不可用" });
  await act(async () => useAppStore.setState({ saveFoodDefinition: save }));
  await submit();
  expect(container.textContent).toContain("数据库暂不可用");
  expect(input("食物名称").value).toBe("原味燕麦");
  expect(input("能量（").value).toBe("400");
  await submit();
  expect(save.mock.calls[0][3]).toBe(save.mock.calls[1][3]);
  expect(useAppStore.getState().foodDefinitions).toHaveLength(1);
  await act(async () => useAppStore.setState({ saveFoodDefinition: original }));
});

it("blocks closing during save and does not submit a double-click twice", async () => {
  await enterFood();
  const original = useAppStore.getState().saveFoodDefinition;
  let resolve!: (result: { error: string }) => void;
  const save = vi.fn(() => new Promise<{ error: string }>((done) => { resolve = done; }));
  await act(async () => useAppStore.setState({ saveFoodDefinition: save }));
  await submit();
  await submit();
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="关闭"]')!.click());
  expect(closed).not.toHaveBeenCalled();
  expect(save).toHaveBeenCalledTimes(1);
  await act(async () => resolve({ error: "模拟保存失败" }));
  expect(input("食物名称").value).toBe("原味燕麦");
  await act(async () => useAppStore.setState({ saveFoodDefinition: original }));
});

it("retains a multi-food basket on recording failure and retries it once", async () => {
  await enterFood(); await submit();
  await fill(container.querySelector<HTMLInputElement>('[aria-label="摄入数量"]')!, "50");
  await click("加入本餐");
  await fill(container.querySelector<HTMLInputElement>('[aria-label="摄入数量"]')!, "25");
  await click("加入本餐");
  const record = vi.fn(originalRecord).mockResolvedValueOnce({ error: "记录保存失败" });
  await act(async () => useAppStore.setState({ recordFoodMeal: record }));
  await click("确认写入 2 项食物");
  expect(container.textContent).toContain("记录保存失败");
  expect(container.textContent).toContain("本次待确认 · 2 项");
  expect(useAppStore.getState().meals).toHaveLength(0);
  await click("确认写入 2 项食物");
  expect(record.mock.calls[0][1]).toBe(record.mock.calls[1][1]);
  expect(useAppStore.getState().meals.map((item) => item.nutrition.calories.value)).toEqual([200, 100]);
  expect(closed).toHaveBeenCalledTimes(1);
});

it("previews the batch total and corrects a basket quantity in place", async () => {
  await enterFood(); await submit();
  await fill(container.querySelector<HTMLInputElement>('[aria-label="摄入数量"]')!, "50");
  await click("加入本餐");
  await fill(container.querySelector<HTMLInputElement>('[aria-label="摄入数量"]')!, "25");
  await click("加入本餐");
  // 50g=200kcal/6g 蛋白 + 25g=100kcal/3g 蛋白 → 300 kcal / 9 g；纤维未知，不得按 0 显示。
  const summary = container.querySelector('[aria-label="本批营养合计"]')!;
  expect(summary.textContent).toContain("300");
  expect(summary.textContent).toContain("9");
  expect(summary.textContent).toContain("未知");
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="修改原味燕麦数量"]')!.click());
  await fill(container.querySelector<HTMLInputElement>('[aria-label="修改原味燕麦的数量"]')!, "100");
  expect(container.querySelector('[aria-label="本批营养合计"]')!.textContent).toContain("500");
  await click("确认写入 2 项食物");
  expect(useAppStore.getState().meals.map((item) => item.nutrition.calories.value)).toEqual([400, 100]);
  expect(closed).toHaveBeenCalledTimes(1);
});

it("invalidates only the revised food in the basket and preserves historical meals", async () => {
  await enterFood(); await submit();
  await click("加入本餐");
  await click("修订规格");
  await fill(input("能量（"), "600");
  await act(async () => input("我已核对").click());
  await submit();
  expect(container.textContent).toContain("本次待确认 · 0 项");
  expect(container.textContent).toContain("v2");
  expect(useAppStore.getState().foodDefinitionVersions).toHaveLength(2);
  expect(useAppStore.getState().meals).toHaveLength(0);
  expect(useAppStore.getState().foodDefinitionVersions[0].nutrition.calories.value).toBe(400);
});
