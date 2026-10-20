import { addDays, format, subDays } from "date-fns";
import { nutrition } from "./calculations";
import type { AppState, InventoryLot, PlanCandidate } from "./types";

const now = new Date();
const today = format(now, "yyyy-MM-dd");
const tomorrow = format(addDays(now, 1), "yyyy-MM-dd");

const inventory: InventoryLot[] = [
  {
    id: "lot-tofu",
    foodId: "food-tofu",
    name: "北豆腐",
    purchasedAmount: 300,
    remainingAmount: 300,
    unit: "g",
    purchasePriceCny: 4.9,
    purchasedAt: today,
    receivedAt: today,
    expiresAt: format(addDays(now, 2), "yyyy-MM-dd"),
    opened: false,
    confidence: "high",
    source: "手工确认",
  },
  {
    id: "lot-pork",
    foodId: "food-pork-tenderloin",
    name: "猪里脊",
    purchasedAmount: 400,
    remainingAmount: 400,
    unit: "g",
    purchasePriceCny: 18.8,
    purchasedAt: today,
    receivedAt: today,
    expiresAt: format(addDays(now, 2), "yyyy-MM-dd"),
    opened: false,
    confidence: "high",
    source: "多多买菜",
  },
  {
    id: "lot-onion",
    foodId: "food-onion",
    name: "洋葱",
    purchasedAmount: 500,
    remainingAmount: 500,
    unit: "g",
    purchasePriceCny: 3.6,
    purchasedAt: format(subDays(now, 1), "yyyy-MM-dd"),
    receivedAt: today,
    expiresAt: format(addDays(now, 8), "yyyy-MM-dd"),
    opened: false,
    confidence: "medium",
    source: "多多买菜",
  },
  {
    id: "lot-rice",
    foodId: "food-rice-raw",
    name: "大米（生重）",
    purchasedAmount: 2500,
    remainingAmount: 2100,
    unit: "g",
    purchasePriceCny: 24.9,
    purchasedAt: format(subDays(now, 5), "yyyy-MM-dd"),
    receivedAt: format(subDays(now, 4), "yyyy-MM-dd"),
    expiresAt: format(addDays(now, 160), "yyyy-MM-dd"),
    opened: true,
    confidence: "high",
    source: "网购",
  },
  {
    id: "lot-oil",
    foodId: "food-oil",
    name: "食用油",
    purchasedAmount: 900,
    remainingAmount: 860,
    unit: "g",
    purchasePriceCny: 18.9,
    purchasedAt: format(subDays(now, 20), "yyyy-MM-dd"),
    receivedAt: format(subDays(now, 18), "yyyy-MM-dd"),
    expiresAt: format(addDays(now, 250), "yyyy-MM-dd"),
    opened: true,
    confidence: "medium",
    source: "网购",
  },
];

const plans: PlanCandidate[] = [
  {
    id: "plan-1",
    recipeVersionId: "recipe-pork-tofu-v1",
    date: tomorrow,
    title: "洋葱豆腐炖里脊",
    description: "一锅供午晚餐共享，优先消耗两日内到期的豆腐和里脊。",
    caloriesKcal: 883,
    proteinG: 119.57,
    fiberG: 2.4,
    estimatedCostCny: 24.1,
    cookingMinutes: 28,
    inventoryCoverage: 100,
    reasons: ["临期优先", "无需补货", "高蛋白", "30分钟内"],
    missingIngredients: [],
    status: "candidate",
  },
  {
    id: "plan-2",
    date: tomorrow,
    title: "番茄里脊豆腐煲",
    description: "同批食材的口味变体，增加番茄和菌菇补充蔬菜。",
    caloriesKcal: 915,
    proteinG: 116,
    fiberG: 7.8,
    estimatedCostCny: 29.3,
    cookingMinutes: 30,
    inventoryCoverage: 82,
    reasons: ["减少尾料", "纤维更高", "口味变化"],
    missingIngredients: ["番茄 300克", "菌菇 150克"],
    status: "candidate",
  },
  {
    id: "plan-3",
    date: tomorrow,
    title: "微波蒸蛋配里脊洋葱",
    description: "利用微波炉减少清洁负担，保留米饭作为两餐主食。",
    caloriesKcal: 946,
    proteinG: 108,
    fiberG: 5.1,
    estimatedCostCny: 27.6,
    cookingMinutes: 24,
    inventoryCoverage: 90,
    reasons: ["清洁负担低", "设备可用", "口味变化"],
    missingIngredients: ["鸡蛋 2个"],
    status: "candidate",
  },
];

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
  recipes: [
    {
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
    },
  ],
  batches: [],
  consumptionEvents: [],
  wasteEvents: [],
  auditEvents: [],
  inventory,
  inventoryMovements: [],
  purchases: [],
  inbox: [
    {
      id: "welcome-inbox",
      kind: "text",
      title: "欢迎使用手机收件箱",
      preview: "手机上传的 Keep 截图、营养标签和商品链接会先出现在这里，确认前不会写入正式数据。",
      receivedAt: now.toISOString(),
      status: "unreviewed",
    },
  ],
  plans,
  aiSettings: {
    provider: "openai",
    baseUrl: "https://api.openai.com/v1",
    model: "",
    monthlyLimitCny: 30,
    estimatedSpendCny: 0,
    usageMonth: format(now, "yyyy-MM"),
    cloudEnabled: false,
  },
};

/** Desktop onboarding starts without fictional health or stock records. */
export function createPersonalState(): AppState {
  const state = structuredClone(initialState);
  state.measurements = [];
  state.inventory = [];
  state.checkIns = [];
  state.plans = state.plans.map((plan) => ({
    ...plan,
    status: "candidate",
    inventoryCoverage: 0,
    reasons: ["首次使用请确认实际库存后再规划"],
    missingIngredients: plan.recipeVersionId
      ? state.recipes.find((recipe) => recipe.id === plan.recipeVersionId)?.ingredients.map((item) => item.name) ?? []
      : plan.missingIngredients,
  }));
  return state;
}
