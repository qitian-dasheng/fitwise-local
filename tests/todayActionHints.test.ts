import { expect, it } from "vitest";
import { bodyActionHint, mealActionHint, workoutActionHint } from "../src/domain/todayHints";
import { nextMealSlot } from "../src/domain/meals";
import type { BodyMeasurement, MealEntry, WorkoutSession } from "../src/domain/types";

const known = (value: number) => ({ state: "known" as const, value });

function meal(id: string, date: string, type: MealEntry["type"], name = "测试餐"): MealEntry {
  const nutrients = { calories: known(300), protein: known(20), carbohydrates: known(30), fat: known(8), fiber: known(4), sugar: known(3), sodium: known(300) };
  return {
    id, date, type, name,
    amount: 1, amountLabel: "1 份", unit: "份",
    consumedRatio: 1, source: "manual", confidence: "high",
    nutrition: nutrients,
    createdAt: `${date}T08:00:00+08:00`,
  } as unknown as MealEntry;
}

function workout(id: string, date: string, name: string, durationMinutes: number, status?: WorkoutSession["status"]): WorkoutSession {
  return { id, date, name, type: "力量", durationMinutes, status, createdAt: `${date}T20:00:00+08:00` };
}

function measurement(id: string, date: string, weightKg: number, extra: Partial<BodyMeasurement> = {}): BodyMeasurement {
  return { id, date, weightKg, measuredAt: `${date}T07:10:00+08:00`, condition: "morning", createdAt: `${date}T07:10:00+08:00`, ...extra };
}

const DATE = "2026-10-22";
const TODAY = "2026-10-22";

it("points the meal hint at the first meal not recorded yet", () => {
  expect(nextMealSlot([], DATE)).toBe("breakfast");
  expect(nextMealSlot([meal("m1", DATE, "breakfast")], DATE)).toBe("lunch");
  expect(nextMealSlot([meal("m1", DATE, "breakfast"), meal("m2", DATE, "lunch")], DATE)).toBe("dinner");
  expect(nextMealSlot(["breakfast", "lunch", "dinner", "snack"].map((type, index) => meal(`m${index}`, DATE, type as MealEntry["type"])), DATE)).toBeNull();
  // 别的日期的记录不该把今天的餐次挤掉。
  expect(nextMealSlot([meal("m1", "2026-10-21", "breakfast"), meal("m2", "2026-10-21", "lunch")], DATE)).toBe("breakfast");
});

it("renders the meal hint from state instead of a copy claim the button never performs", () => {
  const empty = mealActionHint([], DATE);
  expect(empty.text).toBe("早餐还没记");
  expect(empty.slot).toBe("breakfast");
  // 点「吃了什么」只打开餐次表单，不会复制任何东西，所以文案里不许出现「照搬」。
  expect(empty.text).not.toContain("照搬");

  const afterBreakfast = mealActionHint([meal("m1", DATE, "breakfast")], DATE);
  expect(afterBreakfast.text).toBe("午餐还没记");
  expect(afterBreakfast.slot).toBe("lunch");

  const full = mealActionHint(["breakfast", "lunch", "dinner", "snack"].map((type, index) => meal(`m${index}`, DATE, type as MealEntry["type"])), DATE);
  expect(full.text).toBe("四餐都已记录");
  expect(full.slot).toBeNull();
});

it("reports today's minutes when trained today and the last session otherwise", () => {
  expect(workoutActionHint([], DATE)).toBe("还没有训练记录");

  const todayOnly = [workout("w1", DATE, "徒手减脂", 22)];
  expect(workoutActionHint(todayOnly, DATE)).toBe("今日已记 22 分钟");

  const withYesterday = [...todayOnly, workout("w0", "2026-10-21", "哑铃循环", 35)];
  expect(workoutActionHint(withYesterday, DATE)).toBe("今日已记 22 分钟");
  expect(workoutActionHint([withYesterday[1]], DATE)).toBe("上次 哑铃循环 · 35 分钟");
});

it("never quotes a voided or superseded workout as the last session", () => {
  const list = [
    workout("w1", "2026-10-21", "已作废", 40, "void"),
    workout("w2", "2026-10-20", "已更正", 50, "superseded"),
    workout("w3", "2026-10-19", "有效", 30),
  ];
  expect(workoutActionHint(list, DATE)).toBe("上次 有效 · 30 分钟");
  expect(workoutActionHint([list[0], list[1]], DATE)).toBe("还没有训练记录");
});

it("shortens a long course name so the hint stays one line", () => {
  const long = workout("w1", "2026-10-21", "Keep B4 手环徒手减脂课程进阶版", 22);
  // 空格不计入长度：截到 8 个可见字，「Keep B4 手环」刚好放得下。
  expect(workoutActionHint([long], DATE)).toBe("上次 Keep B4 手环… · 22 分钟");
  const short = workout("w2", "2026-10-21", "徒手减脂", 22);
  expect(workoutActionHint([short], DATE)).toBe("上次 徒手减脂 · 22 分钟");
});

it("shows the recorded weight for that day and only claims 'not weighed' when truly absent", () => {
  const list = [measurement("b1", DATE, 83.8)];
  expect(bodyActionHint(list, DATE, TODAY)).toBe("已记 83.8 kg");
  // 翻历史日报时说「今晨」是假话。
  expect(bodyActionHint(list, "2026-10-21", TODAY)).toBe("所选日没有称重");
  expect(bodyActionHint([], TODAY, TODAY)).toBe("今晨还没称重");
});

it("counts a superseded weigh-in as nothing rather than reporting the old number", () => {
  const list = [
    measurement("b1", DATE, 84.5, { status: "superseded", supersededBy: "b2" }),
    measurement("b2", DATE, 83.9, { dayRepresentative: true }),
  ];
  expect(bodyActionHint(list, DATE, TODAY)).toBe("已记 83.9 kg");
  expect(bodyActionHint([list[0]], DATE, TODAY)).toBe("今晨还没称重");
});
