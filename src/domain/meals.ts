import type { MealEntry, MealType } from "./types";
import { activeMeals, entryRatio } from "./calculations";

/** 餐次固定展示顺序：日汇总、餐次小计与录入表单共用，避免各处重复字面量。 */
export const mealTypes = ["breakfast", "lunch", "dinner", "snack"] as const satisfies readonly MealType[];

export const mealLabels: Record<MealType, string> = {
  breakfast: "早餐",
  lunch: "午餐",
  dinner: "晚餐",
  snack: "加餐",
};

/**
 * 所选日第一个还没记录的餐次；四餐都记过时返回 null。
 *
 * 今日页「吃了什么」用它决定点开哪个餐次的表单——原来固定写死早餐，
 * 早上已经记过还开早餐表单，等于逼用户每次手动改一次餐次。
 */
export function nextMealSlot(meals: MealEntry[], date: string): MealType | null {
  const recorded = new Set(
    activeMeals(meals)
      .filter((entry) => entry.date === date)
      .map((entry) => entry.type),
  );
  return mealTypes.find((type) => !recorded.has(type)) ?? null;
}

export interface MealCopySource {
  date: string;
  entries: MealEntry[];
  /** 已按进食比例折算的合计热量；有一条未知就是 null，不按 0 摊薄。 */
  calories: number | null;
}

/**
 * 显式来源日期的照搬来源：目标日期之前不再隐含“取最近”，
 * 由调用方把用户选定的日期传进来；当天没有有效记录返回 null。
 *
 * 只看有效记录：作废或已被更正的条目不能被抄成新记录，否则一次误操作会顺着复制扩散。
 */
export function mealCopySourceOn(meals: MealEntry[], type: MealType, date: string): MealCopySource | null {
  const entries = activeMeals(meals).filter((entry) => entry.type === type && entry.date === date);
  if (!entries.length) return null;
  let calories: number | null = 0;
  for (const entry of entries) {
    const value = entry.nutrition.calories;
    if (value.state !== "known" || value.value === undefined) {
      calories = null;
      break;
    }
    calories += value.value * entryRatio(entry);
  }
  return { date, entries, calories: calories === null ? null : Math.round(calories) };
}

/**
 * 「照搬上次」的来源：目标日期之前、同餐次、仍然有效的记录里，取最近的一天。
 */
export function mealCopySource(meals: MealEntry[], type: MealType, before: string): MealCopySource | null {
  const candidates = activeMeals(meals).filter((entry) => entry.type === type && entry.date < before);
  if (!candidates.length) return null;
  const date = candidates.reduce((latest, entry) => (entry.date > latest ? entry.date : latest), candidates[0].date);
  return mealCopySourceOn(meals, type, date);
}
