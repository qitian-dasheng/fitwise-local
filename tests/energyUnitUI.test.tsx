import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SettingsPage } from "../src/pages/SettingsPage";
import { FoodPage } from "../src/pages/FoodPage";
import { nutrition } from "../src/domain/calculations";
import { diaryToday } from "../src/domain/diary";
import { initialState } from "../src/domain/seed";
import { ENERGY_UNIT_KEY, type EnergyUnitPref } from "../src/domain/preferences";
import { toDisplayEnergy } from "../src/domain/energyDisplay";
import { useAppStore } from "../src/store/appStore";
import type { MealEntry } from "../src/domain/types";

// SettingsPage 挂载会读运行时诊断 / 导出面板；jsdom 无 Tauri 后端，统一 mock 掉 invoke。
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue({}) }));

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  window.localStorage.clear();
  useAppStore.setState({ ...structuredClone(initialState) });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

async function render(ui: React.ReactNode) {
  await act(async () => {
    root.render(ui);
  });
}

function select(): HTMLSelectElement {
  return document.querySelector<HTMLSelectElement>('[data-testid="energy-unit-select"]')!;
}

function optionValueOf(page: HTMLElement, matcher: (option: HTMLOptionElement) => boolean): EnergyUnitPref {
  return [...page.querySelectorAll("option")].filter(matcher)[0]?.value as EnergyUnitPref;
}

it("设置页默认显示 kcal，切换后写入 localStorage 且目标区间换算为 kJ", async () => {
  await render(<SettingsPage />);

  expect(select().value).toBe("kcal");
  const profile = useAppStore.getState().profile;
  expect(host.textContent).toContain(`${profile.dailyCalories.min}–${profile.dailyCalories.max} kcal`);

  await act(async () => {
    select().value = "kJ";
    select().dispatchEvent(new Event("change", { bubbles: true }));
  });

  expect(window.localStorage.getItem(ENERGY_UNIT_KEY)).toBe("kJ");
  expect(host.textContent).toContain(
    `${Math.round(toDisplayEnergy(profile.dailyCalories.min, "kJ"))}–${Math.round(toDisplayEnergy(profile.dailyCalories.max, "kJ"))} kJ`,
  );
});

const day = diaryToday();

function entry(overrides: Partial<MealEntry> & { id: string }): MealEntry {
  return {
    date: day,
    type: "lunch",
    name: overrides.id,
    amountLabel: "100克",
    nutrition: nutrition({}),
    consumedRatio: 1,
    source: "manual",
    confidence: "high",
    createdAt: `${day}T08:00:00Z`,
    ...overrides,
  };
}

const full = (calories: number) =>
  nutrition({ calories, protein: 20, carbohydrates: 30, fat: 10, fiber: 5, sugar: 4, sodium: 200 });

it("饮食页在 kJ 偏好下列头、日合计与行值统一换算", async () => {
  window.localStorage.setItem(ENERGY_UNIT_KEY, "kJ");
  await render(<FoodPage date={day} />);

  const headers = [...host.querySelectorAll(".diary-head > span")].map((cell) => cell.textContent?.trim());
  expect(headers).toContain("热量 kJ");

  await act(async () => {
    useAppStore.setState({ meals: [entry({ id: "燕麦", nutrition: full(300) })] });
  });

  const summaryCalories = host.querySelector('.diary-summary-cell[data-nutrient="calories"] b');
  expect(summaryCalories?.textContent).toBe(String(Math.round(toDisplayEnergy(300, "kJ"))));
});

it("选项文案明确标注默认档", async () => {
  await render(<SettingsPage />);
  const values = [...select().options].map((option) => option.value);
  expect(values).toEqual(["kcal", "kJ"]);
  expect(optionValueOf(host, (option) => option.textContent?.includes("默认") ?? false)).toBe("kcal");
});
