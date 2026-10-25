import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FoodLibraryModal } from "../src/components/FoodLibraryModal";
import { initialState } from "../src/domain/seed";
import { useAppStore } from "../src/store/appStore";
import { useFoodPicker } from "../src/store/foodPicker";

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
  useFoodPicker.setState({ basket: [], editorTarget: null, returnTicket: null });
  container = document.createElement("div"); document.body.append(container);
  root = createRoot(container);
  closed.mockReset(); manual.mockReset();
  await act(async () => { root.render(<FoodLibraryModal onClose={closed} onManual={manual}/>); });
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

it("creates once, previews 50 g and hands the entry to the page basket (弹窗只加不确认)", async () => {
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
  // 第六轮分离式：加入后弹窗不关、不写库，条目进跨页篮子 store，确认写在饮食页。
  expect(useAppStore.getState().meals).toHaveLength(0);
  expect(useFoodPicker.getState().basket).toHaveLength(1);
  expect(useFoodPicker.getState().basket[0]).toMatchObject({ name: "原味燕麦", quantity: 50, unit: "g" });
  expect(container.textContent).toContain("回饮食页展开核对并确认写入");
  // 弹窗内容不随篮子增长：确认按钮/日期/餐次/本批合计都不再出现（提示文案里的字样不算）。
  expect([...container.querySelectorAll("button")].some((b) => b.textContent?.includes("确认写入"))).toBe(false);
  expect(container.textContent).not.toContain("本次待确认");
  expect(container.querySelector('[aria-label="本批营养合计"]')).toBeNull();
  expect(closed).not.toHaveBeenCalled();
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



