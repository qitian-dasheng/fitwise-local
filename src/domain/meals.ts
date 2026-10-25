import type { FoodDefinition, FoodDefinitionVersion, FoodUnit, MealEntry, MealType } from "./types";
import { activeMeals, entryRatio } from "./calculations";
import { shiftDiaryDate } from "./diary";

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

export interface LastPortion {
  quantity: number;
  unit: FoodUnit;
  date: string;
}

/**
 * 该版本最近一次有效摄入的份量：记餐提速用「上次吃了多少」预填默认值。
 * 只认有效记录；没有历史或旧条目缺快照时返回 null，由调用方退回标签默认量。
 */
export function lastPortionForVersion(meals: MealEntry[], versionId: string): LastPortion | null {
  const candidates = activeMeals(meals).filter(
    (entry) => entry.foodVersionId === versionId && typeof entry.foodSnapshot?.quantity === "number" && entry.foodSnapshot.quantity > 0,
  );
  if (!candidates.length) return null;
  const latest = candidates.reduce((best, entry) =>
    entry.date > best.date || (entry.date === best.date && entry.createdAt > best.createdAt) ? entry : best,
  candidates[0]);
  return { quantity: latest.foodSnapshot!.quantity, unit: latest.foodSnapshot!.unit as FoodUnit, date: latest.date };
}

export interface FrequentFood {
  definition: FoodDefinition;
  version: FoodDefinitionVersion;
  count: number;
  lastPortion: LastPortion | null;
}

/**
 * 近 windowDays 天按记餐频次排序的「常吃榜」；每个食物只取当前生效版本。
 * 历史条目可能钉着旧版本，计数按版本反查食物归属，不要求条目仍指向当前版本。
 */
export function frequentFoods(
  meals: MealEntry[],
  definitions: FoodDefinition[],
  versions: FoodDefinitionVersion[],
  today: string,
  windowDays = 30,
  limit = 8,
): FrequentFood[] {
  const windowStart = shiftDiaryDate(today, -(windowDays - 1));
  const activeVersionByFood = new Map<string, FoodDefinitionVersion>();
  const foodByVersion = new Map<string, string>();
  for (const definition of definitions) {
    const version = versions.find((item) => item.id === definition.activeVersionId);
    if (!version) continue;
    activeVersionByFood.set(definition.id, version);
    foodByVersion.set(version.id, definition.id);
  }
  const counts = new Map<string, number>();
  for (const entry of activeMeals(meals)) {
    if (!entry.foodVersionId || entry.date < windowStart || entry.date > today) continue;
    const foodId = foodByVersion.get(entry.foodVersionId);
    if (!foodId || !activeVersionByFood.has(foodId)) continue;
    counts.set(foodId, (counts.get(foodId) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([foodId, count]) => {
      const definition = definitions.find((item) => item.id === foodId)!;
      const version = activeVersionByFood.get(foodId)!;
      return { definition, version, count, lastPortion: lastPortionForVersion(meals, version.id) };
    });
}
