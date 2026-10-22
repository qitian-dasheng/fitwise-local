import { beforeEach, describe, expect, it } from "vitest";
import { calculateFoodPortion, foodMealEntries, saveFoodInState, searchFoodState, validateFoodInput } from "../src/domain/foodLibrary";
import { initialState } from "../src/domain/seed";
import type { FoodDefinitionInput, FoodUnit } from "../src/domain/types";
import { useAppStore } from "../src/store/appStore";

export const oats: FoodDefinitionInput = { name: "原味燕麦", brand: "测试品牌", measurementBasis: "packaged", basis: { quantity: 100, unit: "g" }, energyUnit: "kcal", nutrients: { calories: 400, protein: 12, fat: 0 }, conversions: [{ unit: "package", quantity: 1, basisQuantity: 200 }], source: "label" };

beforeEach(() => {
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  localStorage.clear();
  useAppStore.setState(structuredClone(initialState));
});

describe("food library", () => {
  it.each<FoodUnit>(["g", "ml", "piece", "serving", "package"])("scales native %s and preserves unknown vs zero", (unit) => {
    const saved = saveFoodInState(initialState, { ...oats, basis: { quantity: 100, unit }, conversions: [] }, "test-food");
    const preview = calculateFoodPortion(saved.state.foodDefinitionVersions[0], 50, unit);
    expect(preview.nutrition.calories.value).toBe(200);
    expect(preview.nutrition.protein.value).toBe(6);
    expect(preview.nutrition.fat.state).toBe("zero");
    expect(preview.nutrition.fiber).toMatchObject({ state: "unknown" });
    expect(preview.nutrition.fiber.value).toBeUndefined();
  });

  it("keeps raw kJ label, derives grams only with confirmed conversion", () => {
    const saved = saveFoodInState(initialState, { ...oats, basis: { quantity: 1, unit: "package" }, energyUnit: "kJ", nutrients: { calories: 1673.6 }, conversions: [{ unit: "g", quantity: 200, basisQuantity: 1 }] }, "test-food");
    const version = saved.state.foodDefinitionVersions[0];
    expect(version.labelNutrients.calories).toBe(1673.6);
    expect(calculateFoodPortion(version, 50, "g").nutrition.calories.value).toBeCloseTo(100);
    const item = searchFoodState(saved.state, "测试品牌", "all")[0];
    expect(item.per100g?.calories.value).toBeCloseTo(200);
    expect(item.per100ml).toBeUndefined();
    expect(() => calculateFoodPortion(version, 50, "ml")).toThrow("换算关系");
  });

  it("keeps historical meals and recipes immutable across spec revision", () => {
    const first = saveFoodInState(initialState, oats, "test-food");
    const meals = foodMealEntries(first.state, { date: "2026-10-20", type: "lunch", entries: [{ foodVersionId: first.result.foodVersionId, quantity: 50, unit: "g" }] }, "test-meal");
    const state = { ...first.state, meals };
    const revised = saveFoodInState(state, { ...oats, nutrients: { calories: 600 } }, "revision", first.result.foodId, first.result.foodVersionId);
    expect(revised.state.foodDefinitionVersions).toHaveLength(2);
    expect(revised.state.meals[0].nutrition.calories.value).toBe(200);
    expect(revised.state.meals[0].foodSnapshot?.version.labelNutrients.calories).toBe(400);
    expect(revised.state.recipes).toEqual(initialState.recipes);
    expect(() => foodMealEntries(revised.state, { date: "2026-10-20", type: "dinner", entries: [{ foodVersionId: first.result.foodVersionId, quantity: 50, unit: "g" }] }, "stale-meal")).toThrow("更新");
  });

  it("reopens persisted library, favorites and recent use without nutrition re-entry", async () => {
    const result = await useAppStore.getState().saveFoodDefinition(oats);
    expect(result.error).toBeUndefined();
    expect(useAppStore.getState().meals).toHaveLength(0);
    await useAppStore.getState().setFoodFavorite(result.foodId!, true);
    await useAppStore.getState().recordFoodMeal({ date: "2026-10-20", type: "breakfast", entries: [{ foodVersionId: result.foodVersionId!, quantity: 50, unit: "g" }] });
    const persisted = localStorage.getItem("fitwise-app-state-v1")!;
    expect(JSON.parse(persisted).version).toBe(4);
    // Read the saved envelope, not the in-memory store, to model a fresh load.
    const reloaded = JSON.parse(persisted).state;
    expect(searchFoodState(reloaded, "测试品牌", "favorites")).toHaveLength(1);
    expect(searchFoodState(reloaded, "", "recent")).toHaveLength(1);
    expect(reloaded.meals[0].nutrition.calories.value).toBe(200);
  });

  it("rejects invalid quantities and preserves state on failed batch", async () => {
    expect(() => validateFoodInput({ ...oats, basis: { quantity: 0, unit: "g" } })).toThrow();
    expect(() => validateFoodInput({ ...oats, nutrients: { protein: -1 } })).toThrow();
    const result = await useAppStore.getState().saveFoodDefinition(oats);
    const before = useAppStore.getState();
    const failed = await useAppStore.getState().recordFoodMeal({ date: "2026-10-20", type: "lunch", entries: [{ foodVersionId: result.foodVersionId!, quantity: 50, unit: "g" }, { foodVersionId: result.foodVersionId!, quantity: 50, unit: "ml" }] });
    expect(failed.error).toContain("换算关系");
    expect(useAppStore.getState().meals).toBe(before.meals);
  });

  it("upgrades v3 by adding empty collections without changing previous records", async () => {
    const state = structuredClone(initialState);
    const old = { ...state, foodDefinitions: undefined, foodDefinitionVersions: undefined };
    const migrated = await useAppStore.persist.getOptions().migrate!(old, 3) as typeof state;
    expect(migrated.foodDefinitions).toEqual([]);
    expect(migrated.foodDefinitionVersions).toEqual([]);
    for (const key of ["meals", "recipes", "measurements"] as const) expect(migrated[key]).toEqual(state[key]);
  });
});
