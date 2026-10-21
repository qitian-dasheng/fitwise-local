import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TrendsPage } from "../src/pages/TrendsPage";
import { initialState } from "../src/domain/seed";
import { useAppStore } from "../src/store/appStore";
import type { BodyMeasurement, DailyCheckIn, MealEntry, WorkoutSession } from "../src/domain/types";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  window.localStorage.clear();
  useAppStore.setState({
    ...structuredClone(initialState),
    meals: [],
    checkIns: [],
    workouts: [],
    measurements: [],
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

const metricCard = (value: string) => [...host.querySelectorAll("button")].find((item) => item.textContent === value);

function meal(date: string, calories: number, protein: number): MealEntry {
  // unit 必须收窄成字面量联合，否则会被推成 string，NutrientValue 不认。
  const known = (value: number, unit: "kcal" | "g" | "mg" = "g") => ({
    state: "known" as const,
    value,
    unit,
    source: "manual" as const,
    confidence: "high" as const,
  });
  return {
    id: `meal-${date}`,
    date,
    type: "lunch",
    name: "标准锅",
    amountLabel: "1 份",
    consumedRatio: 1,
    nutrition: {
      calories: known(calories, "kcal"),
      protein: known(protein),
      carbohydrates: known(200),
      fat: known(60),
      fiber: known(28),
      sugar: known(15),
      sodium: known(1800),
    },
    createdAt: `${date}T12:00:00+08:00`,
    source: "manual",
    confidence: "high",
  };
}

const checkIn = (date: string): DailyCheckIn => ({ date, complete: true });

async function renderPage(data: {
  meals?: MealEntry[];
  checkIns?: DailyCheckIn[];
  workouts?: WorkoutSession[];
  measurements?: BodyMeasurement[];
} = {}) {
  await act(async () => {
    useAppStore.setState({
      meals: data.meals ?? [],
      checkIns: data.checkIns ?? [],
      workouts: data.workouts ?? [],
      measurements: data.measurements ?? [],
    });
    root.render(<TrendsPage date="2026-10-21" />);
  });
}

it("renders the review sections on an empty database without NaN", async () => {
  await renderPage();

  expect(host.querySelector(".trends-page")).toBeTruthy();
  expect(host.querySelectorAll(".metric-card")).toHaveLength(4);
  expect(host.querySelector(".review-gauge")).toBeTruthy();
  expect(host.textContent).toContain("待记录");
  expect(host.querySelectorAll(".calendar-grid .calendar-cell.calendar-none")).toHaveLength(7);
  expect(host.textContent).not.toContain("NaN");
  expect(host.textContent).not.toContain("目标调整建议尚未启用");
});

it("switches the range and keeps the hint, calendar and chart in sync", async () => {
  await renderPage();
  expect(host.querySelector(".form-hint")?.textContent).toContain("2026-10-15 至 2026-10-21（7 天）");
  expect(host.querySelectorAll(".calendar-grid .calendar-cell")).toHaveLength(7);

  const tabs = [...host.querySelectorAll(".range-tabs button")] as HTMLButtonElement[];
  expect(tabs.map((item) => item.textContent)).toEqual(["7 天", "14 天", "30 天"]);

  await act(async () => tabs[1].click());
  expect(host.querySelector(".form-hint")?.textContent).toContain("2026-10-08 至 2026-10-21（14 天）");
  expect(host.querySelectorAll(".calendar-grid .calendar-cell")).toHaveLength(14);
  expect(host.querySelector(".range-tabs button.active")?.textContent).toBe("14 天");

  await act(async () => tabs[2].click());
  expect(host.querySelectorAll(".calendar-grid .calendar-cell")).toHaveLength(30);
});

it("counts only complete days into the daily average", async () => {
  await renderPage({
    meals: [
      meal("2026-10-18", 1800, 110),
      meal("2026-10-19", 1800, 110),
      meal("2026-10-20", 2600, 110), // 有记录但超上限，不算完整日的平均值
    ],
    checkIns: [checkIn("2026-10-18"), checkIn("2026-10-19")],
  });

  const cards = [...host.querySelectorAll(".metric-card")].map((item) => item.textContent ?? "");
  const average = cards.find((text) => text.includes("日均热量"))!;
  expect(average).toContain("1800 kcal");
  expect(average).toContain("完整日 2 天");
});

it("marks hit, miss and unconfirmed days apart in the calendar", async () => {
  await renderPage({
    meals: [
      meal("2026-10-18", 1800, 110),
      meal("2026-10-19", 2600, 110),
      meal("2026-10-20", 1800, 90),
    ],
    checkIns: [checkIn("2026-10-18"), checkIn("2026-10-19"), checkIn("2026-10-20")],
  });

  expect(host.querySelectorAll(".calendar-grid .calendar-cell.calendar-hit")).toHaveLength(1);
  expect(host.querySelectorAll(".calendar-grid .calendar-cell.calendar-miss")).toHaveLength(2);
  expect(host.querySelectorAll(".calendar-grid .calendar-cell.calendar-complete")).toHaveLength(3);
  expect(host.textContent).toContain("1 天达标");
});

it("keeps the day incomplete when the record itself was never confirmed", async () => {
  await renderPage({
    meals: [meal("2026-10-20", 1800, 110)],
    checkIns: [],
  });
  // 未确认完成仍然算达标（数值对），但不带「已确认完整」的描边。
  expect(host.querySelectorAll(".calendar-grid .calendar-cell.calendar-hit")).toHaveLength(1);
  expect(host.querySelectorAll(".calendar-grid .calendar-cell.calendar-complete")).toHaveLength(0);
});

it("draws workouts into the calendar and the range metric", async () => {
  await renderPage({
    workouts: [
      {
        id: "w1",
        date: "2026-10-20",
        name: "B4 全身进阶",
        type: "低冲击有氧",
        durationMinutes: 22,
        caloriesKcal: 169,
        createdAt: "2026-10-20T20:00:00+08:00",
      },
      {
        id: "w2",
        date: "2026-10-20",
        name: "录错的",
        type: "有氧",
        durationMinutes: 60,
        status: "void",
        createdAt: "2026-10-20T21:00:00+08:00",
      },
    ],
  });
  const cards = [...host.querySelectorAll(".metric-card")].map((item) => item.textContent ?? "");
  const workoutCard = cards.find((text) => text.includes("区间运动"))!;
  expect(workoutCard).toContain("1 次");
  expect(workoutCard).toContain("22 分钟");
  expect(host.querySelectorAll(".calendar-dot:not(.calendar-dot-legend)")).toHaveLength(1);
});

it("shows the weekly delta once both windows have enough weigh-ins", async () => {
  const measure = (date: string, weightKg: number): BodyMeasurement => ({
    id: `m-${date}`,
    date,
    weightKg,
    createdAt: `${date}T06:30:00+08:00`,
  });
  await renderPage({
    measurements: [
      measure("2026-10-08", 83.6),
      measure("2026-10-10", 83.6),
      measure("2026-10-12", 83.6),
      measure("2026-10-15", 83.0),
      measure("2026-10-17", 83.0),
      measure("2026-10-19", 83.0),
    ],
  });
  expect(host.querySelector(".gauge-value")?.textContent).toContain("0.60");
  expect(host.textContent).toContain("周降幅在安全速率内");
  expect(host.querySelector(".gauge-pin")).toBeTruthy();
});

it("always states that the verdicts are not a health assessment", async () => {
  await renderPage({ meals: [meal("2026-10-20", 1800, 110)], checkIns: [checkIn("2026-10-20")] });
  expect(host.querySelector(".review-notes")).toBeTruthy();
  expect(host.textContent).toContain("不构成健康评估");
  expect(host.textContent).toContain("不会自动修改你的目标");
});
