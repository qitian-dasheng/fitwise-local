/**
 * 能量显示层换算：数据库与领域计算统一用 kcal，这里只负责「显示成什么单位」。
 * 系数与 Rust 侧 label_checks::KCAL_PER_KJ 同源（1 kcal = 4.184 kJ），两套口径必须一致。
 * 录入表单保持 kcal 标注不变——录入口径 = 存储口径，避免逐字段单位混排。
 */
import type { EnergyUnitPref } from "./preferences";

export const KJ_PER_KCAL = 4.184;

/** 表头 / 单位后缀用短写。 */
export const energyUnitLabels: Record<EnergyUnitPref, string> = { kcal: "kcal", kJ: "kJ" };

/** 今日页 hero 等整句文案用中文名。 */
export const energyUnitNames: Record<EnergyUnitPref, string> = { kcal: "千卡", kJ: "千焦" };

/** kcal 存储值 → 显示数值；kJ 四舍五入到整数（kJ 的小数没有信息量），kcal 原样返回。 */
export function toDisplayEnergy(kcal: number, unit: EnergyUnitPref): number {
  if (!Number.isFinite(kcal)) return kcal;
  return unit === "kcal" ? kcal : Math.round(kcal * KJ_PER_KCAL);
}

/** 可空版本：null / undefined 原样透传，供「未知热量」占位走原有分支。 */
export function toDisplayEnergyMaybe(
  kcal: number | null | undefined,
  unit: EnergyUnitPref,
): number | null | undefined {
  return kcal === null || kcal === undefined ? kcal : toDisplayEnergy(kcal, unit);
}

/** 「数值 + 单位」一步到位；非有限数显示「未知」，与营养列的口径一致。 */
export function formatEnergy(kcal: number | null | undefined, unit: EnergyUnitPref): string {
  if (kcal === null || kcal === undefined || !Number.isFinite(kcal)) return "未知";
  return `${toDisplayEnergy(kcal, unit)} ${energyUnitLabels[unit]}`;
}
