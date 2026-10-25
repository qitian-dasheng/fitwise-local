import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TodayPage } from "../src/pages/TodayPage";
import { FoodPage } from "../src/pages/FoodPage";
import { initialState } from "../src/domain/seed";
import { diaryToday, shiftDiaryDate } from "../src/domain/diary";
import { useAppStore } from "../src/store/appStore";
import type { MealEntry, MealType } from "../src/domain/types";

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  useAppStore.setState(structuredClone(initialState));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

const known = (value: number) => ({ state: "known" as const, value });
/** 必须覆盖 nutrientKeys 全部七个键：逐条精确判定缺失，少一个就会在汇总时炸掉。 */
function nutrients(calories: number) {
  return {
    calories: known(calories),
    protein: known(20),
    carbohydrates: known(30),
    fat: known(8),
    fiber: known(4),
    sugar: known(3),
    sodium: known(300),
  };
}
function meal(id: string, date: string, type: MealType): MealEntry {
  return {
    id, date, type, name: `${type}测试`,
    amount: 1, amountLabel: "1 份", unit: "份",
    consumedRatio: 1, source: "manual", confidence: "high",
    nutrition: nutrients(300),
    createdAt: `${date}T08:00:00+08:00`,
  } as unknown as MealEntry;
}
const headerButton = (label: string) =>
  [...container.querySelectorAll<HTMLButtonElement>(".ui-page-head button, .ui-bottom button")].find((item) => item.textContent?.includes(label))!;
const weighTitle = () => headerButton("称重").getAttribute("title");
const workoutHint = () => [...container.querySelectorAll(".ui-panel-head")].find((item) => item.textContent?.includes("这一天感觉怎么样"))?.querySelector("span")?.textContent;

it("renders every quick hint from the stored records instead of hardcoded copy", async () => {
  const date = diaryToday();
  useAppStore.setState({
    meals: [meal("m1", date, "breakfast")],
    workouts: [
      { id: "w1", date: shiftDiaryDate(date, -1), name: "哑铃循环", type: "力量", durationMinutes: 35, createdAt: `${shiftDiaryDate(date, -1)}T20:00:00+08:00` },
    ],
    measurements: [],
  });
  await act(async () => root.render(<TodayPage goTo={() => undefined}/>));

  // 方向 D：吃了什么的提示进「记一笔」的直达餐次，称重提示进按钮 title，运动提示在主观状态卡头。
  expect(weighTitle()).toBe("今晨还没称重");
  expect(workoutHint()).toBe("上次 哑铃循环 · 35 分钟");
  // 0.6.1 之前这些是写死的假数据，任何一条回来都算回归。
  expect(container.textContent).not.toContain("照搬上次早餐");
  expect(container.textContent).not.toContain("上次 22 分钟");
});

it("tells the truth after the record changes, including the all-recorded and weighed states", async () => {
  const date = diaryToday();
  useAppStore.setState({
    meals: [meal("m1", date, "breakfast"), meal("m2", date, "lunch"), meal("m3", date, "dinner"), meal("m4", date, "snack")],
    workouts: [{ id: "w1", date, name: "徒手减脂", type: "有氧", durationMinutes: 22, createdAt: `${date}T20:00:00+08:00` }],
    measurements: [{ id: "b1", date, weightKg: 83.8, measuredAt: `${date}T07:10:00+08:00`, condition: "morning", createdAt: `${date}T07:10:00+08:00` }],
  });
  await act(async () => root.render(<TodayPage goTo={() => undefined}/>));

  expect(weighTitle()).toBe("已记 83.8 kg");
  expect(workoutHint()).toBe("今日已记 22 分钟");
});

it("passes the pending meal slot to the quick action so the form opens on the right meal", async () => {
  const date = diaryToday();
  useAppStore.setState({ meals: [meal("m1", date, "breakfast"), meal("m2", date, "lunch")] });
  const calls: Array<[string, MealType | undefined]> = [];
  await act(async () => root.render(<TodayPage goTo={() => undefined} onQuickAction={(kind, mealType) => calls.push([kind, mealType])}/>));

  await act(async () => headerButton("记一笔").click());
  expect(calls.at(-1)).toEqual(["food", "dinner"]);
  await act(async () => headerButton("记运动").click());
  expect(calls.at(-1)).toEqual(["workout", undefined]);
});

/** 表单里的餐次是「餐次」标签下的 select；直接读它的值才算真验证。 */
function selectedMealType() {
  const label = [...container.querySelectorAll("label")].find((item) => item.querySelector("span")?.textContent === "餐次");
  return label?.querySelector<HTMLSelectElement>("select")?.value ?? null;
}

it("opens the meal form on the requested meal type instead of always breakfast", async () => {
  const date = diaryToday();
  const onConsumed = vi.fn();
  await act(async () => root.render(<FoodPage date={date} autoOpenMeal autoOpenMealType="dinner" onAutoOpenConsumed={onConsumed}/>));
  // 表单已开且回报过一次，避免同一次意图重复触发。
  expect(onConsumed).toHaveBeenCalledTimes(1);
  expect(selectedMealType()).toBe("dinner");
  // 选项本身要齐全，否则「开在晚餐」可能只是因为根本没有别的可选项。
  const label = [...container.querySelectorAll("label")].find((item) => item.querySelector("span")?.textContent === "餐次");
  expect([...label!.querySelectorAll("option")].map((item) => item.value)).toEqual(["breakfast", "lunch", "dinner", "snack"]);
});

it("falls back to breakfast when no meal type is handed over", async () => {
  await act(async () => root.render(<FoodPage date={diaryToday()} autoOpenMeal/>));
  expect(selectedMealType()).toBe("breakfast");
});
