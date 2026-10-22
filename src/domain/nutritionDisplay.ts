import type { DataSource, MealEntry, NutrientKey } from "./types";
import type { NutritionSummary } from "./calculations";
import { entryRatio } from "./calculations";
import { KJ_PER_KCAL, energyUnitLabels } from "./energyDisplay";
import type { EnergyUnitPref } from "./preferences";

export interface NutrientColumn {
  key: NutrientKey;
  label: string;
  unit: "kcal" | "g" | "mg";
  /** 热量与钠取整，其余保留一位小数。 */
  digits: 0 | 1;
}

/** 列顺序即明细表列顺序：热量、蛋白、碳水、脂肪、纤维、糖，钠按需追加。 */
export const nutrientColumns: NutrientColumn[] = [
  { key: "calories", label: "热量", unit: "kcal", digits: 0 },
  { key: "protein", label: "蛋白质", unit: "g", digits: 1 },
  { key: "carbohydrates", label: "碳水", unit: "g", digits: 1 },
  { key: "fat", label: "脂肪", unit: "g", digits: 1 },
  { key: "fiber", label: "纤维", unit: "g", digits: 1 },
  { key: "sugar", label: "糖", unit: "g", digits: 1 },
];

export const sodiumColumn: NutrientColumn = { key: "sodium", label: "钠", unit: "mg", digits: 0 };

export function columns(showSodium: boolean): NutrientColumn[] {
  return showSodium ? [...nutrientColumns, sodiumColumn] : nutrientColumns;
}

export const sourceLabels: Record<DataSource, string> = {
  label: "包装标签",
  personal: "个人食材库",
  official: "官方资料",
  ai_estimate: "估算",
  fatsecret: "FatSecret",
  manual: "手工记录",
};

export const sourceLabel = (source: DataSource): string => sourceLabels[source] ?? source;

export type NutrientDisplayState = "none" | "unknown" | "partial" | "known";

export interface NutrientDisplay {
  state: NutrientDisplayState;
  text: string;
  title?: string;
}

const digitsOf = (key: NutrientKey): 0 | 1 => (key === "calories" || key === "sodium" ? 0 : 1);

/** 显示层单位换算：只有热量受能量单位开关影响，其余营养一律原样。 */
function displayValue(value: number, key: NutrientKey, unit: EnergyUnitPref): number {
  if (key !== "calories" || unit === "kcal") return value;
  return value * KJ_PER_KCAL;
}

/** 热量列在 kJ 模式下表头/单位后缀跟随开关，其余列单位不变。 */
export function columnUnit(key: NutrientKey, unit: EnergyUnitPref, fallback: string): string {
  return key === "calories" ? energyUnitLabels[unit] : fallback;
}

/** 统一数字口径：按位数取整并去掉无意义的尾零，不做四舍五入以外的加工。 */
export function formatNutrientValue(value: number, key: NutrientKey): string {
  if (!Number.isFinite(value)) return "未知";
  const digits = digitsOf(key);
  const rounded = value.toFixed(digits);
  return digits === 0 ? rounded : String(Number(rounded));
}

/** 单条记录的营养：一律乘进食比例；未知永不显示为 0。unit 只影响热量列的显示单位。 */
export function entryNutrient(entry: MealEntry, key: NutrientKey, unit: EnergyUnitPref = "kcal"): NutrientDisplay {
  const metric = entry.nutrition[key];
  if (metric.state === "unknown") {
    return { state: "unknown", text: "未知", title: "这条记录没有提供该营养，不能当作 0" };
  }
  const value = displayValue((metric.value ?? 0) * entryRatio(entry), key, unit);
  const title = entryRatio(entry) < 1 ? `按进食比例 ${Math.round(entryRatio(entry) * 100)}% 折算` : undefined;
  return { state: "known", text: formatNutrientValue(value, key), title };
}

/**
 * 小计与日合计的口径：
 * - 没有有效记录 → 「—」，不能显示 0；
 * - 该键全部未知 → 「未知」；
 * - 存在未知 → 「≥已知小计」，提示仍有未计入部分；
 * - 全部已知 → 直接显示数字。
 */
export function totalNutrient(
  summary: NutritionSummary,
  key: NutrientKey,
  options: { entryCount: number; missing: boolean },
  unit: EnergyUnitPref = "kcal",
): NutrientDisplay {
  if (options.entryCount === 0) return { state: "none", text: "—", title: "这个范围还没有记录" };
  if (summary.coverage[key] === 0) {
    return { state: "unknown", text: "未知", title: "所有记录都没有提供该营养，不能当作 0" };
  }
  const text = formatNutrientValue(displayValue(summary.totals[key], key, unit), key);
  if (options.missing) {
    return {
      state: "partial",
      text: `≥${text}`,
      title: `已知项小计，覆盖率 ${summary.coverage[key]}%；仍有记录未提供该营养`,
    };
  }
  return { state: "known", text };
}

/**
 * 品牌单独成列没有意义，只在 amountLabel 未包含品牌时补一段说明。
 * 食材库记餐会把品牌拼进 amountLabel（foodLibrary.ts），这里必须去重。
 */
export function mealBrand(entry: MealEntry): string | undefined {
  const brand = entry.foodSnapshot?.definition.brand?.trim();
  if (!brand) return undefined;
  return entry.amountLabel.includes(brand) ? undefined : brand;
}
