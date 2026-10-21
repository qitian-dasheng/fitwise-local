import type { MealType } from "./types";

/** 餐次固定展示顺序：日汇总、餐次小计与录入表单共用，避免各处重复字面量。 */
export const mealTypes = ["breakfast", "lunch", "dinner", "snack"] as const satisfies readonly MealType[];

export const mealLabels: Record<MealType, string> = {
  breakfast: "早餐",
  lunch: "午餐",
  dinner: "晚餐",
  snack: "加餐",
};
