import { format } from "date-fns";
import { nutrition } from "./calculations";
import type { RecipeVersion, AppState } from "./types";

const now = new Date();
const today = format(now, "yyyy-MM-dd");

export const initialState: AppState = {
  foodDefinitions: [],
  foodDefinitionVersions: [],
  profile: {
    name: "风那不谈",
    sex: "male",
    age: 22,
    heightCm: 172,
    startWeightKg: 83,
    targetWeightKg: 78.9,
    timezone: "Asia/Shanghai",
    dailyCalories: { min: 1700, target: 1800, max: 1900 },
    proteinTargetG: 100,
    fiberTargetG: 25,
    equipment: ["电饭煲", "电磁炉", "微波炉", "基础锅具"],
  },
  meals: [],
  checkIns: [{ date: today, complete: false }],
  measurements: [
    {
      id: "weight-start",
      date: today,
      weightKg: 83,
      createdAt: now.toISOString(),
    },
  ],
  workouts: [],
  recipes: [],
  auditEvents: [],
  pantryItems: [],
};

/** Desktop onboarding starts without fictional health records. */
export function createPersonalState(): AppState {
  const state = structuredClone(initialState);
  state.measurements = [];
  state.checkIns = [];
  return state;
}

/**
 * 演示菜谱夹具：0.9.4 起不再随 initialState 下发（桌面首启与浏览器预览都从零开始，
 * 详见第五轮反馈「删除默认菜谱」）；仅作为测试夹具保留。
 */
export const seedRecipe: RecipeVersion = {
      id: "recipe-pork-tofu-v1",
      recipeId: "recipe-pork-tofu",
      name: "洋葱豆腐炖里脊",
      version: 1,
      ingredients: [
        { foodId: "food-tofu", name: "北豆腐", amount: 300, unit: "g", measurementBasis: "raw" },
        { foodId: "food-pork-tenderloin", name: "猪里脊", amount: 400, unit: "g", measurementBasis: "raw" },
        { foodId: "food-onion", name: "洋葱", amount: 100, unit: "g", measurementBasis: "raw" },
        { foodId: "food-oil", name: "食用油", amount: 10, unit: "g", measurementBasis: "raw" },
      ],
      nutrition: nutrition(
        { calories: 883, protein: 119.57, carbohydrates: 16.11, fat: 38.16, fiber: 2.4, sugar: 6.27 },
        "fatsecret",
      ),
      totalMinutes: 30,
      equipment: ["电磁炉", "基础锅具"],
  source: "fatsecret",
  createdAt: now.toISOString(),
};

