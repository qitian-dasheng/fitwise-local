import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TrendsPage } from "../src/pages/TrendsPage";
import { initialState } from "../src/domain/seed";
import { diaryToday } from "../src/domain/diary";
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

async function renderPage(
  data: {
    meals?: MealEntry[];
    checkIns?: DailyCheckIn[];
    workouts?: WorkoutSession[];
    measurements?: BodyMeasurement[];
  } = {},
  props: { onDateChange?: (date: string) => void; goTo?: (page: string) => void } = {},
) {
  await act(async () => {
    useAppStore.setState({
      meals: data.meals ?? [],
      checkIns: data.checkIns ?? [],
      workouts: data.workouts ?? [],
      measurements: data.measurements ?? [],
    });
    root.render(<TrendsPage date="2026-10-21" {...props} />);
  });
}

it("renders the review sections on an empty database without NaN", async () => {
  await renderPage();

  expect(host.querySelector(".trends-page")).toBeTruthy();
  expect(host.querySelectorAll(".metric-card")).toHaveLength(5);
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
  expect(tabs.map((item) => item.textContent)).toEqual(["7 天", "14 天", "30 天", "自定义"]);

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

function unknownCalorieMeal(date: string): MealEntry {
  const entry = meal(date, 0, 110);
  return {
    ...entry,
    id: `unknown-${date}`,
    nutrition: { ...entry.nutrition, calories: { state: "unknown", unit: "kcal", source: "manual", confidence: "high" } },
  };
}

it("explains why days are missing from the calorie chart", async () => {
  await renderPage({
    meals: [meal("2026-10-18", 1800, 110), unknownCalorieMeal("2026-10-20")],
    checkIns: [checkIn("2026-10-18"), checkIn("2026-10-20")],
  });
  expect(host.querySelector(".chart-note")?.textContent).toContain("1 天热量不全未计入");
});

it("names the incomplete days when the chart has nothing to draw", async () => {
  await renderPage({
    meals: [unknownCalorieMeal("2026-10-19"), unknownCalorieMeal("2026-10-20")],
    checkIns: [checkIn("2026-10-19"), checkIn("2026-10-20")],
  });
  expect(host.querySelector(".empty-chart")?.textContent).toContain("2 天有记录但热量不全");
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

it("lets the range be set by hand and keeps the calendar in step", async () => {
  await renderPage();
  const customTab = [...host.querySelectorAll(".range-tabs button")].find(
    (item) => item.textContent === "自定义",
  ) as HTMLButtonElement;
  await act(async () => customTab.click());

  const inputs = [...host.querySelectorAll(".range-custom input")] as HTMLInputElement[];
  expect(inputs).toHaveLength(2);
  expect(inputs[0].value).toBe("2026-10-15");
  expect(inputs[1].value).toBe("2026-10-21");

  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(inputs[0], "2026-10-01");
    inputs[0].dispatchEvent(new Event("input", { bubbles: true }));
  });

  expect(host.querySelector(".form-hint")?.textContent).toContain("2026-10-01 至 2026-10-21（21 天）");
  expect(host.querySelectorAll(".calendar-grid .calendar-cell")).toHaveLength(21);

  // 回到预设要把自定义收起来，并且区间跟着预设走。
  const back = [...host.querySelectorAll(".range-custom button")].find((item) =>
    item.textContent?.includes("回到"),
  ) as HTMLButtonElement;
  await act(async () => back.click());
  expect(host.querySelector(".range-custom")).toBeNull();
  expect(host.querySelector(".form-hint")?.textContent).toContain("（7 天）");
});

it("jumps to the picked day when a calendar cell is clicked", async () => {
  const onDateChange = vi.fn();
  const goTo = vi.fn();
  await renderPage({ meals: [meal("2026-10-18", 2000, 170)] }, { onDateChange, goTo });

  const cells = [...host.querySelectorAll(".calendar-grid button.calendar-cell")] as HTMLButtonElement[];
  expect(cells).toHaveLength(7);
  const target = cells.find((cell) => cell.textContent?.includes("18"))!;
  await act(async () => target.click());

  expect(onDateChange).toHaveBeenCalledWith("2026-10-18");
  expect(goTo).toHaveBeenCalledWith("food");
  expect(host.querySelector(".calendar-hint")?.textContent).toContain("点任意一格");
});

it("puts the waist change next to the weight change", async () => {
  await renderPage({
    measurements: [
      { id: "w1", date: "2026-10-17", weightKg: 83.6, waistCm: 93.5, createdAt: "2026-10-17T06:00:00+08:00", source: "manual" },
      { id: "w2", date: "2026-10-20", weightKg: 82.9, waistCm: 92, createdAt: "2026-10-20T06:00:00+08:00", source: "manual" },
    ],
  });

  const cards = [...host.querySelectorAll(".metric-card")].map((item) => item.textContent ?? "");
  const waist = cards.find((text) => text.includes("区间腰围变化"))!;
  expect(waist).toContain("-1.5 cm");
  expect(waist).toContain("最新 92.0 cm");
  expect(cards.find((text) => text.includes("区间体重变化"))).toContain("kg");
});

it("says so plainly when the range has no waist measurement", async () => {
  await renderPage();
  const cards = [...host.querySelectorAll(".metric-card")].map((item) => item.textContent ?? "");
  const waist = cards.find((text) => text.includes("区间腰围变化"))!;
  expect(waist).toContain("区间内未量");
  expect(waist).toContain("在「身体」页记一次腰围");
});

// ===== 0.4.11 区间记忆与日历跳转目标 =====

const setDateValue = (input: HTMLInputElement, value: string) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
};

async function remount() {
  await act(async () => root.unmount());
  root = createRoot(host);
}

it("remembers the chosen preset across a remount", async () => {
  await renderPage();
  await act(async () => metricCard("14 天")!.click());
  expect(host.querySelector(".form-hint")?.textContent).toContain("（14 天）");

  await remount();
  await renderPage();
  expect(host.querySelector(".form-hint")?.textContent).toContain("（14 天）");
});

it("remembers a custom range with both endpoints", async () => {
  await renderPage();
  await act(async () => metricCard("自定义")!.click());
  const inputs = [...host.querySelectorAll(".range-custom input")] as HTMLInputElement[];
  await act(async () => setDateValue(inputs[0], "2026-10-01"));
  expect(host.querySelector(".form-hint")?.textContent).toContain("2026-10-01 至 2026-10-21（21 天）");

  await remount();
  await renderPage();
  const restored = [...host.querySelectorAll(".range-custom input")] as HTMLInputElement[];
  expect(restored).toHaveLength(2);
  expect(restored[0].value).toBe("2026-10-01");
  expect(restored[1].value).toBe("2026-10-21");
  expect(host.querySelectorAll(".calendar-grid .calendar-cell")).toHaveLength(21);
});

it("clamps a stored end date that is in the future", async () => {
  window.localStorage.setItem(
    "qingheng.trends.range",
    JSON.stringify({ mode: "custom", start: "2026-10-01", end: "2099-01-01" }),
  );
  await renderPage();

  const inputs = [...host.querySelectorAll(".range-custom input")] as HTMLInputElement[];
  // 存量偏好里的结束日可能晚于今天（跨时区、改过系统时间），进 state 前必须收回。
  expect(inputs[1].value).toBe(diaryToday());
  expect(host.querySelectorAll(".calendar-grid .calendar-cell").length).toBeLessThanOrEqual(92);
});

it("falls back to seven days when the preference is corrupt", async () => {
  window.localStorage.setItem("qingheng.trends.range", "not-json");
  await renderPage();
  expect(host.querySelector(".range-custom")).toBeNull();
  expect(host.querySelector(".form-hint")?.textContent).toContain("（7 天）");

  window.localStorage.setItem("qingheng.trends.range", JSON.stringify({ mode: "preset", days: 999 }));
  await remount();
  await renderPage();
  expect(host.querySelector(".form-hint")?.textContent).toContain("（7 天）");
});

it("jumps to the chosen destination and renames the calendar hint", async () => {
  const goTo = vi.fn();
  await renderPage({ meals: [meal("2026-10-18", 2000, 170)] }, { goTo });

  const targets = [...host.querySelectorAll(".calendar-target button")] as HTMLButtonElement[];
  expect(targets.map((item) => item.textContent)).toEqual(["饮食", "身体", "运动"]);
  expect(host.querySelector(".calendar-hint")?.textContent).toContain("饮食记录");

  await act(async () => targets[1].click());

  const cells = [...host.querySelectorAll(".calendar-grid button.calendar-cell")] as HTMLButtonElement[];
  const target = cells.find((cell) => cell.textContent?.includes("18"))!;
  // 文案要跟着目标变，不能出现「点了却说跳饮食」的错提示。
  expect(target.title).toContain("身体记录");
  await act(async () => target.click());
  expect(goTo).toHaveBeenLastCalledWith("body");
  expect(host.querySelector(".calendar-hint")?.textContent).toContain("身体记录");
});
