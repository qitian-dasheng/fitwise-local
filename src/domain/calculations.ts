import type {
  DailyCheckIn,
  BodyMeasurement,
  MealEntry,
  MealType,
  NutritionFacts,
  NutrientKey,
  NutrientValue,
} from "./types";
import { nutrientKeys } from "./types";
import { mealTypes } from "./meals";
import { compareMeasurements, isActiveMeasurement } from "./body";

export const known = (
  value: number,
  unit: NutrientValue["unit"],
  source: NutrientValue["source"] = "manual",
  confidence: NutrientValue["confidence"] = "high",
): NutrientValue => ({ state: value === 0 ? "zero" : "known", value, unit, source, confidence });

export const unknown = (
  unit: NutrientValue["unit"],
  source: NutrientValue["source"] = "ai_estimate",
): NutrientValue => ({ state: "unknown", unit, source, confidence: "low" });

export const nutrition = (values: Partial<Record<NutrientKey, number>>, source: NutrientValue["source"] = "manual"): NutritionFacts => ({
  calories: values.calories === undefined ? unknown("kcal", source) : known(values.calories, "kcal", source),
  protein: values.protein === undefined ? unknown("g", source) : known(values.protein, "g", source),
  carbohydrates: values.carbohydrates === undefined ? unknown("g", source) : known(values.carbohydrates, "g", source),
  fat: values.fat === undefined ? unknown("g", source) : known(values.fat, "g", source),
  fiber: values.fiber === undefined ? unknown("g", source) : known(values.fiber, "g", source),
  sugar: values.sugar === undefined ? unknown("g", source) : known(values.sugar, "g", source),
  sodium: values.sodium === undefined ? unknown("mg", source) : known(values.sodium, "mg", source),
});

export interface NutritionSummary {
  totals: Record<NutrientKey, number>;
  coverage: Record<NutrientKey, number>;
}
export const activeMeals = (entries: MealEntry[]) => entries.filter(item => !item.status || item.status === "active");

/** 进食比例统一口径：缺失或非数按 100% 处理，避免旧记录渲染出 NaN。 */
export function entryRatio(entry: Pick<MealEntry, "consumedRatio">): number {
  const ratio = Number(entry.consumedRatio);
  return Number.isFinite(ratio) ? Math.max(0, Math.min(1, ratio)) : 1;
}

export interface MealGroup {
  type: MealType;
  entries: MealEntry[];
  summary: NutritionSummary;
}

/** 固定返回四个餐次且顺序稳定，空餐次也返回（entries 为空数组）。 */
export function groupMealsByType(entries: MealEntry[]): MealGroup[] {
  const active = activeMeals(entries);
  return mealTypes.map((type) => {
    const items = active.filter((entry) => entry.type === type);
    return { type, entries: items, summary: summarizeMeals(items) };
  });
}

/** 逐条精确判定缺失：只要有一条有效记录（份额大于 0）没提供该营养，就算不完整。 */
export function missingNutrientKeys(entries: MealEntry[]): NutrientKey[] {
  const effective = activeMeals(entries).filter((entry) => entryRatio(entry) > 0);
  return nutrientKeys.filter((key) => effective.some((entry) => entry.nutrition[key].state === "unknown"));
}

export function summarizeMeals(entries: MealEntry[]): NutritionSummary {
  const totals = Object.fromEntries(nutrientKeys.map((key) => [key, 0])) as Record<NutrientKey, number>;
  const knownWeights = Object.fromEntries(nutrientKeys.map((key) => [key, 0])) as Record<NutrientKey, number>;
  const allWeights = Object.fromEntries(nutrientKeys.map((key) => [key, 0])) as Record<NutrientKey, number>;

  for (const entry of activeMeals(entries)) {
    const ratio = entryRatio(entry);
    for (const key of nutrientKeys) {
      allWeights[key] += ratio;
      const metric = entry.nutrition[key];
      if (metric.state !== "unknown") {
        totals[key] += (metric.value ?? 0) * ratio;
        knownWeights[key] += ratio;
      }
    }
  }

  const coverage = Object.fromEntries(
    nutrientKeys.map((key) => [key, allWeights[key] === 0 ? 0 : Math.round((knownWeights[key] / allWeights[key]) * 100)]),
  ) as Record<NutrientKey, number>;

  return { totals, coverage };
}

export function movingAverage(values: { date: string; value: number }[], windowSize = 7) {
  return values.map((item) => {
    const current = Date.parse(`${item.date}T00:00:00Z`);
    const earliest = current - (windowSize - 1) * 864e5;
    const slice = values.filter((point) => { const time = Date.parse(`${point.date}T00:00:00Z`); return time >= earliest && time <= current; });
    return {
      date: item.date,
      value: slice.length ? slice.reduce((sum, point) => sum + point.value, 0) / slice.length : item.value,
    };
  });
}

export function activeMeasurements(measurements: BodyMeasurement[]) {
  return measurements.filter(isActiveMeasurement).slice().sort(compareMeasurements);
}

export function completedDateSet(checkIns: DailyCheckIn[]) {
  return new Set(checkIns.filter((item) => item.complete).map((item) => item.date));
}

/** [start, end] 区间内被确认完整的自然日数量。 */
export function completedDayCount(checkIns: DailyCheckIn[], start: string, end: string) {
  return [...completedDateSet(checkIns)].filter((date) => date >= start && date <= end).length;
}

export function completedDayCalorieAverage(entries: MealEntry[], checkIns: DailyCheckIn[]) {
  const completed = completedDateSet(checkIns);
  const grouped = new Map<string, MealEntry[]>();
  for (const entry of activeMeals(entries)) {
    if (!completed.has(entry.date)) continue;
    grouped.set(entry.date, [...(grouped.get(entry.date) ?? []), entry]);
  }
  if (grouped.size === 0) return null;
  const eligible = [...grouped.values()].filter((day) => day.every((meal) => meal.nutrition.calories.state !== "unknown" && Number.isFinite(meal.nutrition.calories.value))).map(summarizeMeals);
  if (!eligible.length) return null;
  return eligible.reduce((sum, day) => sum + day.totals.calories, 0) / eligible.length;
}
