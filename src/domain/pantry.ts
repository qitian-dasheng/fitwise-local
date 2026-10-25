import type { FoodUnit, PantryItem, RecipeVersion } from "./types";

/**
 * 食物柜域函数（0.9.4 库存轻量版）。
 * 边界：只回答「家里还有什么、快没了没」；缺货提示只做同单位比较，
 * 单位不同（如柜内 克 vs 菜谱 个）不计入缺货——换算是食材库换算器的职责。
 */

/** 快捷增减的步长：按单位给合理档位（克 50、毫升 100，计数单位 1）。 */
export function pantryStepForUnit(unit: FoodUnit): number {
  if (unit === "g") return 50;
  if (unit === "ml") return 100;
  return 1;
}

/** 低于阈值即「快没了」；没设阈值只到 0 才算没货。 */
export function isLowStock(item: PantryItem): boolean {
  if (item.quantity <= 0) return true;
  return item.lowStockThreshold !== undefined && item.quantity < item.lowStockThreshold;
}

/** 距到期天数（负数=已过期）；无到期日返回 null。 */
export function daysUntilExpiry(item: PantryItem, today: string): number | null {
  if (!item.expiresAt) return null;
  const expiry = Date.parse(`${item.expiresAt}T00:00:00Z`);
  const now = Date.parse(`${today}T00:00:00Z`);
  if (Number.isNaN(expiry) || Number.isNaN(now)) return null;
  return Math.round((expiry - now) / 86_400_000);
}

export interface RecipeShortage {
  /** 同单位可比且柜内量不足的原料数。 */
  missingCount: number;
  /** 参与比较的原料名列表（用于提示文案）。 */
  missingNames: string[];
  /** 因单位不一致无法比较的原料数（不计入 missing，单独披露）。 */
  incomparableCount: number;
}

/**
 * 菜谱缺货提示（只读）：逐项原料对比柜内量。
 * - 原料没有对应柜内条目 → 记 1 缺；
 * - 有条目但单位不同 → 记入 incomparable（不猜换算）；
 * - 同单位且柜内量 < 需求量 → 记缺。
 */
export function recipeShortage(recipe: RecipeVersion, pantryItems: PantryItem[]): RecipeShortage {
  const byFood = new Map(pantryItems.map((item) => [item.foodDefinitionId, item]));
  let missingCount = 0;
  let incomparableCount = 0;
  const missingNames: string[] = [];
  for (const ingredient of recipe.ingredients) {
    const entry = byFood.get(ingredient.foodId);
    const required = ingredient.nutritionQuantity ?? ingredient.amount;
    if (!entry) {
      missingCount += 1;
      missingNames.push(ingredient.name);
      continue;
    }
    if (entry.unit !== ingredient.unit) {
      incomparableCount += 1;
      continue;
    }
    if (entry.quantity < required) {
      missingCount += 1;
      missingNames.push(ingredient.name);
    }
  }
  return { missingCount, missingNames, incomparableCount };
}
