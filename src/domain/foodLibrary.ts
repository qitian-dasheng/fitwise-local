import { nutrition } from "./calculations";
import { nutrientKeys, type AppState, type FoodDefinitionInput, type FoodDefinitionVersion, type FoodLibraryItem, type FoodMealInput, type FoodMealPreview, type FoodUnit, type NutritionFacts } from "./types";

export const foodUnitLabels: Record<FoodUnit, string> = { g: "克", ml: "毫升", piece: "个", serving: "份", package: "包装" };
export const foodBasisLabels = { raw: "生重", cooked: "熟重", packaged: "包装标示", edible: "可食部分" };

function positive(value: number) {
  if (!Number.isFinite(value) || value <= 0) throw new Error("数量与换算规格必须是大于 0 的有限数值。");
  return value;
}

export function calculateFoodPortion(version: FoodDefinitionVersion, quantity: number, unit: FoodUnit): FoodMealPreview {
  positive(quantity);
  let basisQuantity = quantity;
  if (unit !== version.basis.unit) {
    const conversion = version.conversions.find((item) => item.unit === unit);
    if (!conversion) throw new Error("没有这个单位的换算关系，请补充并确认规格后再记录。");
    basisQuantity = quantity / conversion.quantity * conversion.basisQuantity;
  }
  positive(basisQuantity);
  const factor = positive(basisQuantity / version.basis.quantity);
  const facts = structuredClone(version.nutrition);
  for (const key of nutrientKeys) {
    if (facts[key].state !== "unknown") {
      const value = (facts[key].value ?? 0) * factor;
      if (!Number.isFinite(value)) throw new Error("换算结果过大，请核对输入单位和数量。");
      facts[key].value = value;
    }
  }
  return { nutrition: facts, factor, basisQuantity };
}

export function validateFoodInput(input: FoodDefinitionInput) {
  if (!input.name.trim() || [...input.name].length > 120 || [...(input.brand ?? "")].length > 120) throw new Error("食物名称不能为空，名称和品牌最多 120 个字符。");
  if (!(input.measurementBasis in foodBasisLabels)) throw new Error("生熟或可食状态无效。");
  if (!(input.basis.unit in foodUnitLabels) || !["kcal", "kJ"].includes(input.energyUnit)) throw new Error("请确认参考单位和能量单位。");
  if (!["manual", "label", "personal", "official", "fatsecret"].includes(input.source)) throw new Error("本版只接受人工确认的数据来源。");
  positive(input.basis.quantity);
  const seen = new Set<FoodUnit>();
  for (const conversion of input.conversions) {
    positive(conversion.quantity); positive(conversion.basisQuantity);
    if (!(conversion.unit in foodUnitLabels) || conversion.unit === input.basis.unit || seen.has(conversion.unit)) throw new Error("换算单位无效，或与参考单位相同、重复。");
    seen.add(conversion.unit);
  }
  if (input.conversions.length > 4) throw new Error("换算规格最多四种。");
  for (const [key, value] of Object.entries(input.nutrients)) {
    if (!nutrientKeys.includes(key as typeof nutrientKeys[number]) || (value !== undefined && (!Number.isFinite(value) || value < 0))) throw new Error("营养值必须是非负有限数值。");
  }
}

export function saveFoodInState(state: AppState, input: FoodDefinitionInput, commandId: string, foodId?: string, expectedVersionId?: string) {
  validateFoodInput(input);
  const previous = foodId ? state.foodDefinitions.find((item) => item.id === foodId) : undefined;
  const previousVersion = previous ? state.foodDefinitionVersions.find((item) => item.id === previous.activeVersionId) : undefined;
  if (foodId && (!previous || !previousVersion || previous.activeVersionId !== expectedVersionId)) throw new Error("此食物的营养规格已更新，请重新选择后修订。");
  if (previous && (previous.name !== input.name.trim() || (previous.brand ?? "") !== (input.brand ?? "").trim() || previous.measurementBasis !== input.measurementBasis)) throw new Error("更换名称、品牌或生熟状态请新建食物。");
  const now = new Date().toISOString();
  const id = foodId ?? `food-${commandId}`;
  const versionId = `food-version-${commandId}`;
  const labelNutrients = Object.fromEntries(Object.entries(input.nutrients).filter(([, value]) => value !== undefined));
  const normalized = { ...labelNutrients };
  if (normalized.calories !== undefined && input.energyUnit === "kJ") normalized.calories /= 4.184;
  const version: FoodDefinitionVersion = { id: versionId, foodId: id, version: (previousVersion?.version ?? 0) + 1, basis: structuredClone(input.basis), conversions: structuredClone(input.conversions), energyUnit: input.energyUnit, labelNutrients, nutrition: nutrition(normalized, input.source), source: input.source, confirmedAt: now, confirmedBy: state.profile.name };
  for (const unit of ["g", "ml"] as const) if (unit === version.basis.unit || version.conversions.some((item) => item.unit === unit)) calculateFoodPortion(version, 100, unit);
  const definition = previous ? { ...previous, activeVersionId: versionId } : { id, name: input.name.trim(), brand: input.brand?.trim() || undefined, measurementBasis: input.measurementBasis, activeVersionId: versionId, favorite: false, createdAt: now };
  return { state: { ...state, foodDefinitions: previous ? state.foodDefinitions.map((item) => item.id === id ? definition : item) : [...state.foodDefinitions, definition], foodDefinitionVersions: [...state.foodDefinitionVersions, version], auditEvents: [...state.auditEvents, { id: `${commandId}:audit`, eventType: previous ? "revise_food_definition" : "save_food_definition", entityType: "food_library", payload: { commandId, foodId: id, foodVersionId: versionId }, createdAt: now }] }, result: { foodId: id, foodVersionId: versionId } };
}

export function foodMealEntries(state: AppState, input: FoodMealInput, commandId: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || new Date(`${input.date}T00:00:00Z`).toISOString().slice(0, 10) !== input.date) throw new Error("记餐日期无效。");
  if (!input.entries.length || input.entries.length > 50) throw new Error("一次可确认 1–50 项食物。");
  return input.entries.map((entry, index) => {
    const version = state.foodDefinitionVersions.find((item) => item.id === entry.foodVersionId);
    const definition = state.foodDefinitions.find((item) => item.id === version?.foodId);
    if (!version || !definition || definition.activeVersionId !== version.id) throw new Error("此食物的营养规格已更新，请重新选择食物并核对数量。");
    const preview = calculateFoodPortion(version, entry.quantity, entry.unit);
    return { id: `${commandId}:food-meal:${index}`, date: input.date, type: input.type, name: definition.name, amountLabel: `${entry.quantity}${foodUnitLabels[entry.unit]} · ${definition.brand ?? "个人食材库"}`, nutrition: preview.nutrition, consumedRatio: 1, source: version.source, confidence: "high" as const, foodDefinitionId: definition.id, foodVersionId: version.id, foodSnapshot: { definition: structuredClone(definition), version: structuredClone(version), quantity: entry.quantity, unit: entry.unit, factor: preview.factor, basisQuantity: preview.basisQuantity }, createdAt: new Date().toISOString() };
  });
}

export function searchFoodState(state: AppState, query: string, mode: "all" | "recent" | "favorites"): FoodLibraryItem[] {
  const needle = query.trim().toLowerCase();
  return state.foodDefinitions.flatMap((definition) => {
    if (!`${definition.name} ${definition.brand ?? ""}`.toLowerCase().includes(needle) || (mode === "favorites" && !definition.favorite)) return [];
    const version = state.foodDefinitionVersions.find((item) => item.id === definition.activeVersionId);
    if (!version) return [];
    const lastUsedAt = state.meals.filter((item) => item.foodDefinitionId === definition.id).map((item) => item.createdAt).sort().at(-1);
    if (mode === "recent" && !lastUsedAt) return [];
    const item: FoodLibraryItem = { definition, version, lastUsedAt };
    for (const [key, unit] of [["per100g", "g"], ["per100ml", "ml"]] as const) {
      if (unit === version.basis.unit || version.conversions.some((conversion) => conversion.unit === unit)) item[key] = calculateFoodPortion(version, 100, unit).nutrition;
    }
    return [item];
  }).sort((a, b) => (mode === "recent" ? (b.lastUsedAt ?? "").localeCompare(a.lastUsedAt ?? "") : 0) || Number(b.definition.favorite) - Number(a.definition.favorite) || a.definition.name.localeCompare(b.definition.name)).slice(0, 100);
}

export function findFoodItem(state: AppState, foodId: string): FoodLibraryItem | undefined {
  const definition = state.foodDefinitions.find((item) => item.id === foodId);
  const version = state.foodDefinitionVersions.find((item) => item.id === definition?.activeVersionId);
  if (!definition || !version) return undefined;
  const item: FoodLibraryItem = { definition, version };
  if (version.basis.unit === "g" || version.conversions.some((conversion) => conversion.unit === "g")) item.per100g = calculateFoodPortion(version, 100, "g").nutrition;
  if (version.basis.unit === "ml" || version.conversions.some((conversion) => conversion.unit === "ml")) item.per100ml = calculateFoodPortion(version, 100, "ml").nutrition;
  return item;
}

export function nutrientLabel(facts: NutritionFacts, key: typeof nutrientKeys[number], digits = 1) {
  return facts[key].state === "unknown" ? "未知" : String(Number((facts[key].value ?? 0).toFixed(digits)));
}
