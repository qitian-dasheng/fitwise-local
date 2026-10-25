import type { TargetProfileInput, UserProfile } from "./types";

/**
 * 目标校验：与 Rust record_commands::apply 的 set_target_profile 守卫保持同一套规则，
 * 浏览器预览与提交前预检都不能放松（镜像纪律，见 appStore weightPayload 注释）。
 */

export const CALORIE_BOUND = { min: 500, max: 8000 } as const;
export const PROTEIN_BOUND = { min: 1, max: 500 } as const;
export const FIBER_BOUND = { min: 0, max: 200 } as const;
export const TARGET_WEIGHT_BOUND = { min: 20, max: 400 } as const;

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

export function validateTargetProfileInput(input: TargetProfileInput): { payload?: TargetProfileInput; error?: string } {
  const { min, target, max } = input.dailyCalories ?? ({} as TargetProfileInput["dailyCalories"]);
  for (const [label, value] of [["热量下限", min], ["热量目标", target], ["热量上限", max]] as const) {
    if (!finite(value) || value < CALORIE_BOUND.min || value > CALORIE_BOUND.max) {
      return { error: `${label}需在 ${CALORIE_BOUND.min}–${CALORIE_BOUND.max} kcal 之间。` };
    }
  }
  if (!(min <= target && target <= max)) {
    return { error: "热量区间需满足：下限 ≤ 目标 ≤ 上限。" };
  }
  if (!finite(input.proteinTargetG) || input.proteinTargetG < PROTEIN_BOUND.min || input.proteinTargetG > PROTEIN_BOUND.max) {
    return { error: `蛋白质目标需在 ${PROTEIN_BOUND.min}–${PROTEIN_BOUND.max} g 之间。` };
  }
  if (!finite(input.fiberTargetG) || input.fiberTargetG < FIBER_BOUND.min || input.fiberTargetG > FIBER_BOUND.max) {
    return { error: `纤维目标需在 ${FIBER_BOUND.min}–${FIBER_BOUND.max} g 之间。` };
  }
  const weight = input.targetWeightKg;
  if (!finite(weight) || weight < TARGET_WEIGHT_BOUND.min || weight > TARGET_WEIGHT_BOUND.max) {
    return { error: `目标体重需在 ${TARGET_WEIGHT_BOUND.min}–${TARGET_WEIGHT_BOUND.max} kg 之间。` };
  }
  if (Math.abs(weight * 100 - Math.round(weight * 100)) > 1e-6) {
    return { error: "目标体重最多保留两位小数。" };
  }
  return {
    payload: {
      dailyCalories: { min, target, max },
      proteinTargetG: input.proteinTargetG,
      fiberTargetG: input.fiberTargetG,
      targetWeightKg: Math.round(weight * 100) / 100,
    },
  };
}

export function targetFieldsOf(profile: UserProfile): TargetProfileInput {
  return {
    dailyCalories: { ...profile.dailyCalories },
    proteinTargetG: profile.proteinTargetG,
    fiberTargetG: profile.fiberTargetG,
    targetWeightKg: profile.targetWeightKg,
  };
}
