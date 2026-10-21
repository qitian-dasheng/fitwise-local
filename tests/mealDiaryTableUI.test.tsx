import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FoodPage } from "../src/pages/FoodPage";
import { nutrition } from "../src/domain/calculations";
import { diaryToday } from "../src/domain/diary";
import { initialState } from "../src/domain/seed";
import { DIARY_SODIUM_KEY } from "../src/domain/preferences";
import { useAppStore } from "../src/store/appStore";
import type { MealEntry, MealType, NutrientKey } from "../src/domain/types";

let host: HTMLDivElement;
let root: Root;
const originalCorrect = useAppStore.getState().correctMeal;

beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  window.localStorage.clear();
  useAppStore.setState({ ...structuredClone(initialState), correctMeal: originalCorrect });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

const day = diaryToday();

function entry(overrides: Partial<MealEntry> & { id: string }): MealEntry {
  return {
    date: day,
    type: "lunch",
    name: overrides.id,
    amountLabel: "100克",
    nutrition: nutrition({ calories: 300, protein: 20 }),
    consumedRatio: 1,
    source: "manual",
    confidence: "high",
    createdAt: `${day}T08:00:00Z`,
    ...overrides,
  };
}

const full = (calories = 300) =>
  nutrition({ calories, protein: 20, carbohydrates: 30, fat: 10, fiber: 5, sugar: 4, sodium: 200 });

async function renderPage(meals: MealEntry[]) {
  await act(async () => {
    useAppStore.setState({ meals });
    root.render(<FoodPage date={day} />);
  });
}

const group = (type: MealType) => host.querySelector(`[data-meal-type="${type}"]`) as HTMLElement;
const mealHead = (type: MealType) => group(type).querySelector(".diary-meal-head") as HTMLElement;
const summaryCell = (key: NutrientKey) => host.querySelector(`.diary-summary-cell[data-nutrient="${key}"]`) as HTMLElement;
const headCell = (key: NutrientKey) => mealHead("lunch").querySelector(`[data-nutrient="${key}"]`) as HTMLElement;
const button = (label: string) => [...host.querySelectorAll("button")].find((item) => item.textContent?.includes(label))!;

it("renders the three layers: daily summary, four meal subtotals and item rows", async () => {
  await renderPage([entry({ id: "燕麦", nutrition: full(300) })]);

  const headers = [...host.querySelectorAll(".diary-head > span")].map((cell) => cell.textContent?.trim());
  expect(headers).toEqual(["食物 / 份量", "热量 kcal", "蛋白质 g", "碳水 g", "脂肪 g", "纤维 g", "糖 g", "操作"]);

  expect(host.querySelectorAll(".diary-meal")).toHaveLength(4);
  expect(host.querySelectorAll(".diary-meal-head")).toHaveLength(4);
  expect(host.querySelectorAll(".food-entry")).toHaveLength(1);
  expect(host.querySelector(".diary-summary")).not.toBeNull();

  // 空餐次只给一条跨列提示，不再铺一排「—」
  expect(group("breakfast").textContent).toContain("还没有记录");
  expect(mealHead("breakfast").querySelector('[data-nutrient="calories"]')).toBeNull();
  expect(mealHead("breakfast").querySelectorAll(".diary-cell-num")).toHaveLength(0);
  expect(group("breakfast").querySelector(".diary-empty-hint")!.textContent).toContain("添加早餐");
  expect(group("breakfast").textContent).not.toContain("—");
  expect(group("breakfast").textContent).not.toContain("0 kcal");
});

it("shows unknown instead of zero and flags the day as incomplete", async () => {
  await renderPage([entry({ id: "外食", nutrition: nutrition({ calories: 300, protein: 20 }) })]);

  expect(headCell("fat").textContent).toBe("未知");
  expect(headCell("carbohydrates").textContent).toBe("未知");
  expect(summaryCell("fat").textContent).toContain("未知");
  expect(summaryCell("calories").textContent).toContain("300");

  const summary = host.querySelector(".diary-summary") as HTMLElement;
  expect(summary.textContent).toContain("未完整");
  expect(host.textContent).not.toContain("达标");
});

it("marks partially known totals with a lower bound", async () => {
  await renderPage([
    entry({ id: "完整餐", nutrition: nutrition({ calories: 300, protein: 20, fat: 10 }) }),
    entry({ id: "缺项餐", nutrition: nutrition({ calories: 100, protein: 10 }) }),
  ]);

  expect(mealHead("lunch").querySelector('[data-nutrient="fat"]')!.textContent).toBe("≥10");
  expect(mealHead("lunch").querySelector('[data-nutrient="protein"]')!.textContent).toBe("30");
  expect(summaryCell("fat").textContent).toContain("≥10");
});

it("keeps each meal subtotal limited to its own rows", async () => {
  await renderPage([
    entry({ id: "午餐一", nutrition: full(300) }),
    entry({ id: "午餐二", nutrition: full(100) }),
    entry({ id: "晚餐", type: "dinner", nutrition: full(500) }),
  ]);

  expect(mealHead("lunch").querySelector('[data-nutrient="calories"]')!.textContent).toBe("400");
  expect(mealHead("dinner").querySelector('[data-nutrient="calories"]')!.textContent).toBe("500");
  expect(summaryCell("calories").textContent).toContain("900");
});

it("scales shared-batch rows by the consumed ratio everywhere", async () => {
  await renderPage([entry({ id: "整锅一半", nutrition: full(300), consumedRatio: 0.5 })]);

  const row = host.querySelector(".food-entry") as HTMLElement;
  expect(row.querySelector('[data-nutrient="calories"]')!.textContent).toBe("150");
  expect(mealHead("lunch").querySelector('[data-nutrient="calories"]')!.textContent).toBe("150");
  expect(summaryCell("calories").textContent).toContain("150");
  expect(row.textContent).toContain("按 50% 计入");
});

it("toggles the sodium column and remembers the choice", async () => {
  await renderPage([entry({ id: "燕麦", nutrition: full(300) })]);

  expect(host.textContent).not.toContain("钠 mg");
  const toggle = host.querySelector<HTMLInputElement>(".diary-sodium-toggle input")!;
  await act(async () => {
    toggle.click();
  });

  expect(host.textContent).toContain("钠 mg");
  expect(host.querySelector('.diary-summary-cell[data-nutrient="sodium"]')!.textContent).toContain("200");
  expect(window.localStorage.getItem(DIARY_SODIUM_KEY)).toBe("1");
  expect(host.querySelector(".diary-table")!.className).toContain("with-sodium");

  await act(async () => {
    host.querySelector<HTMLInputElement>(".diary-sodium-toggle input")!.click();
  });
  expect(host.textContent).not.toContain("钠 mg");
  expect(window.localStorage.getItem(DIARY_SODIUM_KEY)).toBe("0");
});

it("keeps an add entry in every meal even when the meal already has food", async () => {
  await renderPage([entry({ id: "午餐项", nutrition: full(300) })]);

  const addButtons = [...host.querySelectorAll(".diary-meal-head button")].map((item) => item.textContent?.trim());
  expect(addButtons).toEqual(["添加早餐", "添加午餐", "添加晚餐", "添加加餐"]);
  // 页头全局入口仍是唯一的「添加食物」
  expect([...host.querySelectorAll("button")].filter((item) => item.textContent?.trim() === "添加食物")).toHaveLength(1);
});

it("keeps one edit and one void action per row", async () => {
  await renderPage([entry({ id: "燕麦", nutrition: full(300) })]);

  const row = host.querySelector(".food-entry") as HTMLElement;
  expect([...row.querySelectorAll("button")].map((item) => item.textContent?.trim())).toEqual(["编辑", "作废"]);

  await act(async () => button("作废").click());
  expect(host.textContent).toContain("作废餐食记录");
});

it("shows an empty day without pretending anything is zero", async () => {
  await renderPage([]);

  const summary = host.querySelector(".diary-summary") as HTMLElement;
  expect(summary.textContent).toContain("尚无记录");
  expect(summaryCell("calories").textContent).toContain("—");
  expect(host.textContent).not.toContain("0 kcal");
  expect(host.textContent).not.toContain("未完整");
});

it("renders the brand once when the amount label already carries it", async () => {
  const snapshot = {
    definition: { brand: "示例品牌" },
    version: {},
    quantity: 50,
    unit: "g",
    factor: 1,
    basisQuantity: 100,
  } as unknown as MealEntry["foodSnapshot"];
  await renderPage([entry({ id: "燕麦", amountLabel: "50克 · 示例品牌", nutrition: full(300), foodSnapshot: snapshot })]);

  const occurrences = (host.querySelector(".food-entry") as HTMLElement).textContent!.split("示例品牌").length - 1;
  expect(occurrences).toBe(1);
});
