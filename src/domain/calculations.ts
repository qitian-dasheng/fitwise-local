import type {
  DailyCheckIn,
  BodyMeasurement,
  InventoryLot,
  MealEntry,
  NutritionFacts,
  NutrientKey,
  NutrientValue,
} from "./types";
import { nutrientKeys } from "./types";

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

export function summarizeMeals(entries: MealEntry[]): NutritionSummary {
  const totals = Object.fromEntries(nutrientKeys.map((key) => [key, 0])) as Record<NutrientKey, number>;
  const knownWeights = Object.fromEntries(nutrientKeys.map((key) => [key, 0])) as Record<NutrientKey, number>;
  const allWeights = Object.fromEntries(nutrientKeys.map((key) => [key, 0])) as Record<NutrientKey, number>;

  for (const entry of entries) {
    const ratio = Math.max(0, Math.min(1, entry.consumedRatio));
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
  return values.map((item, index) => {
    const slice = values.slice(Math.max(0, index - windowSize + 1), index + 1);
    return {
      date: item.date,
      value: slice.reduce((sum, point) => sum + point.value, 0) / slice.length,
    };
  });
}

export function activeMeasurements(measurements: BodyMeasurement[]) {
  return measurements
    .filter((item) => item.status !== "superseded")
    .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
}

export function completedDateSet(checkIns: DailyCheckIn[]) {
  return new Set(checkIns.filter((item) => item.complete).map((item) => item.date));
}

export function completedDayCalorieAverage(entries: MealEntry[], checkIns: DailyCheckIn[]) {
  const completed = completedDateSet(checkIns);
  const grouped = new Map<string, MealEntry[]>();
  for (const entry of entries) {
    if (!completed.has(entry.date)) continue;
    grouped.set(entry.date, [...(grouped.get(entry.date) ?? []), entry]);
  }
  if (grouped.size === 0) return null;
  const total = [...grouped.values()].reduce((sum, day) => sum + summarizeMeals(day).totals.calories, 0);
  return total / grouped.size;
}

export function deductInventoryFEFO(
  lots: InventoryLot[],
  foodId: string,
  amount: number,
): { lots: InventoryLot[]; deductions: { lotId: string; amount: number }[]; shortage: number } {
  let remaining = amount;
  const deductions: { lotId: string; amount: number }[] = [];
  const ordered = [...lots]
    .filter((lot) => lot.foodId === foodId && lot.remainingAmount > 0)
    .sort((a, b) => {
      if (a.opened !== b.opened) return a.opened ? -1 : 1;
      const expiryA = a.expiresAt ?? "9999-12-31";
      const expiryB = b.expiresAt ?? "9999-12-31";
      return expiryA.localeCompare(expiryB) || a.purchasedAt.localeCompare(b.purchasedAt);
    });

  const next = lots.map((lot) => ({ ...lot }));
  for (const lot of ordered) {
    if (remaining <= 0) break;
    const take = Math.min(lot.remainingAmount, remaining);
    const target = next.find((item) => item.id === lot.id)!;
    target.remainingAmount = Number((target.remainingAmount - take).toFixed(3));
    remaining -= take;
    deductions.push({ lotId: lot.id, amount: take });
  }
  return { lots: next, deductions, shortage: Math.max(0, remaining) };
}

export function remainingDays(expiresAt: string | undefined, now = new Date()) {
  if (!expiresAt) return null;
  const end = new Date(`${expiresAt}T23:59:59`);
  return Math.ceil((end.getTime() - now.getTime()) / 86_400_000);
}
