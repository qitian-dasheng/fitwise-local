import type { AppState } from "./types";

/** 与 Rust `reset_domain_records`（src-tauri/src/domain_store.rs）保持同一套保留口径。 */
export interface ResetSummary {
  keptFoodDefinitions: number;
  keptFoodDefinitionVersions: number;
  keptRecipes: number;
  clearedMeals: number;
  clearedCheckIns: number;
  clearedMeasurements: number;
  clearedWorkouts: number;
  clearedAuditEvents: number;
  clearedCommandReceipts: number;
  droppedFoodVersions: number;
  droppedRecipes: string[];
}

/**
 * 重置保留规则（桌面版由 Rust 在同名事务内执行，浏览器预览在此镜像同一口径）：
 * - 保留：个人目标（profile）、食材库定义、引用了有效定义的营养版本、
 *   每项原料都引用有效营养版本的菜谱；
 * - 清除：饮食、体重/腰围/体脂、运动、打卡与审计事件；
 * - 失效引用明确处置：孤儿营养版本与引用失效的菜谱整体剔除并记名，
 *   不保留无法编辑/保存的菜谱。
 */
export function buildResetState(state: AppState): { state: AppState; summary: ResetSummary } {
  const definitionIds = new Set(state.foodDefinitions.map((item) => item.id));
  const versions = state.foodDefinitionVersions.filter((item) => definitionIds.has(item.foodId));
  const versionIds = new Set(versions.map((item) => item.id));
  const droppedRecipes: string[] = [];
  const recipes = state.recipes.filter((recipe) => {
    const valid =
      recipe.ingredients.length > 0 &&
      recipe.ingredients.every((item) => item.foodVersionId !== undefined && versionIds.has(item.foodVersionId));
    if (!valid) droppedRecipes.push(recipe.name);
    return valid;
  });
  return {
    state: {
      ...state,
      foodDefinitionVersions: versions,
      recipes,
      meals: [],
      checkIns: [],
      measurements: [],
      workouts: [],
      auditEvents: [],
    },
    summary: {
      keptFoodDefinitions: state.foodDefinitions.length,
      keptFoodDefinitionVersions: versions.length,
      keptRecipes: recipes.length,
      clearedMeals: state.meals.length,
      clearedCheckIns: state.checkIns.length,
      clearedMeasurements: state.measurements.length,
      clearedWorkouts: state.workouts.length,
      clearedAuditEvents: state.auditEvents.length,
      clearedCommandReceipts: 0,
      droppedFoodVersions: state.foodDefinitionVersions.length - versions.length,
      droppedRecipes,
    },
  };
}
