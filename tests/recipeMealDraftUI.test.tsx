import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { RecipeMealDraftModal } from "../src/components/RecipeMealDraftModal";
import { nutrition } from "../src/domain/calculations";
import { initialState } from "../src/domain/seed";
import type { RecipeVersion } from "../src/domain/types";
import { useAppStore } from "../src/store/appStore";

let container: HTMLDivElement;
let root: Root;
const closed = vi.fn();
const recorded = vi.fn();
let record: ReturnType<typeof vi.fn>;

/** 200g 燕麦（400 kcal/100g、12g 蛋白/100g）的菜谱快照，等价于整锅 800 kcal。 */
const recipe: RecipeVersion = {
  id: "recipe-version-1",
  recipeId: "recipe-1",
  name: "自制燕麦",
  version: 1,
  totalMinutes: 10,
  equipment: ["电磁炉"],
  source: "personal",
  confirmedBy: "test",
  confirmedAt: "2026-10-24T00:00:00Z",
  createdAt: "2026-10-24T00:00:00Z",
  nutrition: nutrition({ calories: 800, protein: 24 }),
  ingredients: [
    {
      foodId: "food-1",
      name: "燕麦",
      amount: 200,
      unit: "g",
      measurementBasis: "package",
      foodVersionId: "food-version-1",
      nutritionQuantity: 200,
      nutritionUnit: "g",
      foodSnapshot: {
        definition: { id: "food-1", name: "燕麦", measurementBasis: "packaged", activeVersionId: "food-version-1", favorite: false, createdAt: "2026-10-24T00:00:00Z" },
        version: { id: "food-version-1", foodId: "food-1", version: 1, basis: { quantity: 100, unit: "g" }, energyUnit: "kcal", labelNutrients: { calories: 400, protein: 12 }, conversions: [], nutrition: nutrition({ calories: 400, protein: 12 }), source: "label", confirmedBy: "test", confirmedAt: "2026-10-24T00:00:00Z" },
        quantity: 200,
        unit: "g",
        factor: 2,
        basisQuantity: 200,
      },
    },
  ],
};

beforeEach(async () => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  useAppStore.setState({ ...structuredClone(initialState), recordRecipeMeal: (record = vi.fn().mockResolvedValue({})) });
  container = document.createElement("div"); document.body.append(container);
  root = createRoot(container);
  closed.mockReset(); recorded.mockReset();
  await act(async () => { root.render(<RecipeMealDraftModal recipe={recipe} initialType="breakfast" onClose={closed} onRecorded={recorded} />); });
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); });

function button(text: string) {
  const element = [...container.querySelectorAll("button")].find((item) => item.textContent?.includes(text));
  if (!element) throw new Error(`Missing button ${text}`);
  return element;
}
async function click(text: string) { await act(async () => button(text).click()); }
async function fill(element: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set?.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const summary = () => container.querySelector('[aria-label="本批营养合计"]')!.textContent!;

it("states that ×1 is the full recipe yield, not one serving", async () => {
  expect(container.textContent).toContain("×1 = 菜谱完整配方量，不代表一人份");
  // 默认 ×1：整锅 200g → 800 kcal / 24 g 蛋白。
  expect(container.querySelector<HTMLInputElement>('[aria-label="燕麦数量"]')!.value).toBe("200");
  expect(summary()).toContain("800");
  expect(summary()).toContain("24");
});

it("scales the whole recipe by ×0.5 and ×2 and keeps the totals in sync", async () => {
  await click("×0.5");
  expect(container.querySelector<HTMLInputElement>('[aria-label="燕麦数量"]')!.value).toBe("100");
  expect(summary()).toContain("400");
  expect(summary()).toContain("12");
  await click("×2");
  expect(container.querySelector<HTMLInputElement>('[aria-label="燕麦数量"]')!.value).toBe("400");
  expect(summary()).toContain("1600");
  expect(summary()).toContain("48");
});

it("accepts a custom scale with decimals", async () => {
  await fill(container.querySelector<HTMLInputElement>('[aria-label="自定义食用比例"]')!, "1.5");
  expect(container.querySelector<HTMLInputElement>('[aria-label="燕麦数量"]')!.value).toBe("300");
  expect(summary()).toContain("1200");
});

it("excludes an ingredient and blocks confirmation until one remains", async () => {
  await act(async () => { container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click(); });
  expect(summary()).toContain("0 项");
  expect(summary()).toContain("—");
  expect(button("确认写入 0 项食物").hasAttribute("disabled") || container.querySelector("button.primary.wide")!.hasAttribute("disabled")).toBe(true);
  await act(async () => { container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click(); });
  expect(summary()).toContain("1 项");
});

it("confirms with the scaled entries and reports the recorded date", async () => {
  await click("×0.5");
  await click("确认写入 1 项食物");
  expect(record).toHaveBeenCalledTimes(1);
  const input = record.mock.calls[0][0] as { date: string; type: string; recipeVersionId: string; entries: { foodVersionId: string; quantity: number; unit: string }[] };
  expect(input.recipeVersionId).toBe("recipe-version-1");
  expect(input.entries).toEqual([{ foodVersionId: "food-version-1", quantity: 100, unit: "g" }]);
  expect(closed).toHaveBeenCalledTimes(1);
});
