import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SettingsPage } from "../src/pages/SettingsPage";
import { FoodPage } from "../src/pages/FoodPage";
import { nutrition } from "../src/domain/calculations";
import { diaryToday } from "../src/domain/diary";
import { initialState } from "../src/domain/seed";
import { ENERGY_UNIT_KEY } from "../src/domain/preferences";
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

// 0.9.3 板块盘点（用户决策）：显示偏好卡整卡删除，显示单位固定 kcal——
// kJ 录入路径自动换算入库；这些测试把该政策钉死，防止选择器悄悄回来。
it("设置页不再提供能量单位/主题选择器（显示偏好卡已删除）", async () => {
  await render(<SettingsPage />);
  expect(host.querySelector('[data-testid="energy-unit-select"]')).toBeNull();
  expect(host.querySelector('[data-testid="theme-select"]')).toBeNull();
  const profile = useAppStore.getState().profile;
  expect(host.textContent).toContain(`${profile.dailyCalories.min}–${profile.dailyCalories.max} kcal`);
});

it("遗留的 kJ 偏好被忽略：饮食页各处始终以 kcal 显示", async () => {
  window.localStorage.setItem(ENERGY_UNIT_KEY, "kJ");
  await render(<FoodPage date={diaryToday()} />);

  const headers = [...host.querySelectorAll(".diary-head > span")].map((cell) => cell.textContent?.trim());
  expect(headers).toContain("热量 kcal");
  expect(headers).not.toContain("热量 kJ");

  await act(async () => {
    useAppStore.setState({ meals: [entry({ id: "燕麦", nutrition: full(300) })] });
  });

  const summaryCalories = host.querySelector('.diary-summary-cell[data-nutrient="calories"] b');
  expect(summaryCalories?.textContent).toBe("300");
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
  } as MealEntry;
}

const full = (calories: number) =>
  nutrition({ calories, protein: 20, carbohydrates: 30, fat: 10, fiber: 5, sugar: 4, sodium: 200 });
