import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { RecipeEditor } from "../src/components/RecipeEditor";
import { initialState } from "../src/domain/seed";
import { useAppStore } from "../src/store/appStore";
import type { FoodDefinitionInput, RecipeVersion } from "../src/domain/types";

let host: HTMLDivElement, root: Root;
const close = vi.fn(), saved = vi.fn();
const originalSave = useAppStore.getState().saveRecipe;
beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  useAppStore.setState({ ...structuredClone(initialState), saveRecipe: originalSave });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  close.mockReset(); saved.mockReset();
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); });
const button = (label: string) => [...host.querySelectorAll("button")].find(b => b.textContent?.includes(label))!;
const field = (label: string, within: ParentNode = host) => [...within.querySelectorAll("label")].find(l => l.textContent?.includes(label))!.querySelector<HTMLInputElement>("input")!;
const dropdown = (label: string, within: ParentNode = host) => [...within.querySelectorAll("label")].find(l => l.textContent?.includes(label))!.querySelector("select")!;
async function fill(element: HTMLInputElement, value: string) {
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(element, value); element.dispatchEvent(new Event("input", { bubbles: true })); });
}
async function select(element: HTMLSelectElement, value: string) {
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(element, value); element.dispatchEvent(new Event("change", { bubbles: true })); });
}
async function submit() { await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))); }
async function food(overrides: Partial<FoodDefinitionInput> = {}) {
  return useAppStore.getState().saveFoodDefinition({ name: "北豆腐", measurementBasis: "raw", basis: { quantity: 100, unit: "g" }, energyUnit: "kcal", nutrients: { calories: 100, protein: 10 }, conversions: [], source: "label", ...overrides });
}
const legacy = (): RecipeVersion => ({ ...structuredClone(initialState.recipes[0]), ingredients: [{ foodId: "tofu", name: "北豆腐", amount: 300, unit: "g", measurementBasis: "raw" }] });

it("puts metadata and the first named ingredient before optional rules, with one empty-catalog cue", async () => {
  await act(async () => root.render(<RecipeEditor recipe={legacy()} copyMode onClose={close} onSaved={saved} />));
  const form = host.querySelector(".library-fields")!;
  expect(form.firstElementChild?.className).toBe("recipe-summary");
  expect(form.children[1].className).toContain("recipe-metadata");
  const children = [...form.children];
  expect(children.indexOf(form.querySelector(".recipe-ingredient-editor")!)).toBeLessThan(children.indexOf(form.querySelector(".recipe-rules")!));
  expect(host.querySelectorAll(".recipe-context-note")).toHaveLength(1);
  expect(host.querySelector(".recipe-context-note")!.textContent).toContain("食材库为空");
  expect(host.querySelector(".recipe-ingredient-editor h3")!.textContent).toContain("北豆腐");
  expect(host.querySelector<HTMLDetailsElement>(".recipe-rules")!.open).toBe(false);
  expect(host.querySelectorAll(".library-notice")).toHaveLength(0);
  expect(field("原料数量").value).toBe("300");
  expect(button("确认保存").disabled).toBe(true);
});

it("linking a legacy 300g ingredient keeps 300g rather than the 100g nutrition basis", async () => {
  const f = await food();
  await act(async () => root.render(<RecipeEditor recipe={legacy()} copyMode onClose={close} onSaved={saved} />));
  expect(host.querySelector(".recipe-context-note")!.textContent).toContain("1 项原料待关联");
  await select(dropdown("食材与营养版本"), f.foodVersionId!);
  expect(field("原料数量").value).toBe("300");
  expect(dropdown("营养计量单位").value).toBe("g");
  expect(host.textContent).toContain("制作时扣减 300 克");
  expect(host.textContent).toContain("整锅预览：300 kcal");
  expect(host.querySelector(".recipe-context-note")).toBeNull();
  expect(field("已核对该项").checked).toBe(false);
});

it("unsupported units reset only with an explicit warning, never silently map grams to milliliters", async () => {
  const f = await food({ name: "牛奶", measurementBasis: "packaged", basis: { quantity: 250, unit: "ml" } });
  await act(async () => root.render(<RecipeEditor recipe={legacy()} onClose={close} onSaved={saved} />));
  await select(dropdown("食材与营养版本"), f.foodVersionId!);
  expect(field("原料数量").value).toBe("250"); expect(dropdown("营养计量单位").value).toBe("ml");
  expect(host.querySelector(".recipe-unit-notice")!.textContent).toContain("不是自动换算");
  expect(host.querySelector(".recipe-unit-notice")!.textContent).toContain("原来的“克”");
  expect(field("已核对该项").checked).toBe(false);
  expect(button("确认保存").disabled).toBe(true);
});

it("confirmed same-unit conversions preserve package quantities and clear acknowledgement on edits", async () => {
  const f = await food({ conversions: [{ unit: "package", quantity: 1, basisQuantity: 200 }] });
  await act(async () => root.render(<RecipeEditor onClose={close} onSaved={saved} />));
  await fill(field("菜谱名称"), "豆腐锅"); await select(dropdown("食材与营养版本"), f.foodVersionId!);
  await select(dropdown("营养计量单位"), "package"); await fill(field("原料数量"), "2");
  await act(async () => field("已核对该项").click()); expect(button("确认保存").disabled).toBe(false);
  await select(dropdown("食材与营养版本"), f.foodVersionId!);
  expect(field("原料数量").value).toBe("2"); expect(dropdown("营养计量单位").value).toBe("package");
  expect(host.textContent).toContain("制作时扣减 400 克"); expect(field("已核对该项").checked).toBe(false);
  await act(async () => field("已核对该项").click()); await fill(field("原料数量"), "3"); expect(field("已核对该项").checked).toBe(false);
});

it("valid rows keep their own deduction preview even while another row is unlinked", async () => {
  const f = await food();
  await act(async () => root.render(<RecipeEditor onClose={close} onSaved={saved} />));
  await select(dropdown("食材与营养版本"), f.foodVersionId!); await fill(field("原料数量"), "300");
  await act(async () => button("添加一种原料").click());
  expect(host.querySelectorAll(".recipe-ingredient-editor")).toHaveLength(2);
  expect(host.querySelectorAll(".recipe-stock-preview")).toHaveLength(1);
  expect(host.querySelector(".recipe-stock-preview")!.textContent).toContain("300 克");
  expect(host.querySelector(".recipe-context-note")!.textContent).toContain("1 项原料待关联");
  expect(button("确认保存").disabled).toBe(true);
});

it("returning from food management preserves legacy quantities, name and conditional notices", async () => {
  await act(async () => root.render(<RecipeEditor recipe={legacy()} copyMode onClose={close} onSaved={saved} />));
  await fill(field("菜谱名称"), "我的副本"); await fill(field("原料数量"), "350");
  await act(async () => button("管理／新建食材").click());
  await act(async () => { await food(); });
  const library = host.querySelector(".food-library")!;
  await act(async () => library.closest(".modal")!.querySelector<HTMLButtonElement>('[aria-label="关闭"]')!.click());
  expect(field("菜谱名称").value).toBe("我的副本"); expect(field("原料数量").value).toBe("350");
  expect(host.querySelector(".recipe-context-note")!.textContent).not.toContain("食材库为空");
  expect(host.querySelector(".recipe-context-note")!.textContent).toContain("待关联");
  expect(useAppStore.getState().meals).toHaveLength(0); expect(useAppStore.getState().inventoryMovements).toHaveLength(0);
});

it("blocked forms do not submit even via an explicit submit event, and folded equipment remains required", async () => {
  const f = await food(), save = vi.fn().mockResolvedValue({ recipeVersionId: "saved" }); useAppStore.setState({ saveRecipe: save });
  await act(async () => root.render(<RecipeEditor onClose={close} onSaved={saved} />));
  await fill(field("菜谱名称"), "测试配方"); await select(dropdown("食材与营养版本"), f.foodVersionId!); await submit(); expect(save).not.toHaveBeenCalled();
  await act(async () => field("已核对该项").click());
  const rules = host.querySelector<HTMLDetailsElement>(".recipe-rules")!;
  await act(async () => { rules.open = true; });
  for (const checkbox of rules.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) if (checkbox.checked) await act(async () => checkbox.click());
  expect(host.textContent).toContain("尚未选择厨具"); expect(host.textContent).toContain("选择实际厨具后再保存");
  await submit(); expect(save).not.toHaveBeenCalled();
});

it("rejects a below-minimum stock amount before it rounds to an apparently valid deduction", async () => {
  const f = await food();
  await act(async () => root.render(<RecipeEditor onClose={close} onSaved={saved} />));
  await fill(field("菜谱名称"), "极小原料"); await select(dropdown("食材与营养版本"), f.foodVersionId!);
  await fill(field("原料数量"), "0.00006"); await act(async () => field("已核对该项").click());
  expect(host.textContent).toContain("库存扣减量过小或过大"); expect(button("确认保存").disabled).toBe(true);
});
