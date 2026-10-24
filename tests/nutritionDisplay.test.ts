import { describe, expect, it } from "vitest";
import { nutrition, summarizeMeals, missingNutrientKeys, groupMealsByType, entryRatio } from "../src/domain/calculations";
import {
  columns,
  entryNutrient,
  formatNutrientValue,
  mealBrand,
  nutrientText,
  sourceLabel,
  totalNutrient,
} from "../src/domain/nutritionDisplay";
import type { MealEntry, MealType } from "../src/domain/types";

function meal(overrides: Partial<MealEntry> & { id: string }): MealEntry {
  return {
    date: "2026-10-21",
    type: "lunch",
    name: overrides.id,
    amountLabel: "100克",
    nutrition: nutrition({ calories: 300, protein: 20 }),
    consumedRatio: 1,
    source: "manual",
    confidence: "high",
    createdAt: "2026-10-21T00:00:00Z",
    ...overrides,
  };
}

/** 七项营养全部已知的夹具：用于把「缺失」严格限定在被测的那一条记录上。 */
const fullNutrition = (calories = 300) =>
  nutrition({ calories, protein: 20, carbohydrates: 30, fat: 10, fiber: 5, sugar: 4, sodium: 200 });

describe("nutrient formatting", () => {
  it("rounds calories and sodium to integers and keeps one decimal for grams", () => {
    expect(formatNutrientValue(1240.4, "calories")).toBe("1240");
    expect(formatNutrientValue(12.34, "protein")).toBe("12.3");
    expect(formatNutrientValue(12, "protein")).toBe("12");
    expect(formatNutrientValue(120.6, "sodium")).toBe("121");
    expect(formatNutrientValue(Number.NaN, "fat")).toBe("未知");
  });

  it("lists sodium only when the column is enabled", () => {
    expect(columns(false).map((column) => column.key)).toEqual([
      "calories",
      "protein",
      "carbohydrates",
      "fat",
      "fiber",
      "sugar",
    ]);
    expect(columns(true).map((column) => column.key)).toContain("sodium");
    expect(columns(true)).toHaveLength(7);
  });

  it("labels data sources in Chinese", () => {
    expect(sourceLabel("fatsecret")).toBe("FatSecret");
    expect(sourceLabel("label")).toBe("包装标签");
  });
});

describe("recipe nutrient text", () => {
  it("formats known values and never renders unknown as zero", () => {
    const facts = nutrition({ calories: 2015.6, protein: 160.44 });
    expect(nutrientText(facts, "calories")).toBe("2016");
    expect(nutrientText(facts, "protein")).toBe("160.4");
    expect(nutrientText(facts, "fiber")).toBe("未知");
  });

  it("converts calories for the kJ display preference", () => {
    expect(nutrientText(nutrition({ calories: 500 }), "calories", "kJ")).toBe("2092");
  });
});

describe("entry nutrient", () => {
  it("never renders an unknown value as zero", () => {
    const entry = meal({ id: "unknown" });
    expect(entryNutrient(entry, "fat")).toMatchObject({ state: "unknown", text: "未知" });
  });

  it("multiplies by the consumed ratio and keeps zero distinct", () => {
    expect(entryNutrient(meal({ id: "half", consumedRatio: 0.5 }), "calories").text).toBe("150");
    const zero = meal({ id: "zero", nutrition: nutrition({ calories: 300, protein: 20, fat: 0 }) });
    expect(entryNutrient(zero, "fat")).toMatchObject({ state: "known", text: "0" });
  });

  it("falls back to 100% when the ratio is missing or broken", () => {
    const broken = meal({ id: "broken", consumedRatio: Number.NaN });
    expect(entryRatio(broken)).toBe(1);
    expect(entryNutrient(broken, "calories").text).toBe("300");
  });
});

describe("total nutrient", () => {
  it("shows a dash instead of zero when nothing is recorded", () => {
    const empty = summarizeMeals([]);
    expect(totalNutrient(empty, "calories", { entryCount: 0, missing: false })).toMatchObject({ state: "none", text: "—" });
  });

  it("shows unknown when every record lacks the nutrient", () => {
    const entries = [meal({ id: "a" }), meal({ id: "b" })];
    const summary = summarizeMeals(entries);
    expect(totalNutrient(summary, "fat", { entryCount: 2, missing: true })).toMatchObject({ state: "unknown", text: "未知" });
  });

  it("marks a partial total with a lower bound", () => {
    const entries = [
      meal({ id: "known", nutrition: fullNutrition(300) }),
      meal({ id: "unknown", nutrition: nutrition({ calories: 100, protein: 10 }) }),
    ];
    const summary = summarizeMeals(entries);
    const missing = missingNutrientKeys(entries);
    // 蛋白两条都有 → 直接给数字；脂肪只有第一条有 → 只能给下限
    expect(totalNutrient(summary, "protein", { entryCount: 2, missing: missing.includes("protein") })).toMatchObject({
      state: "known",
      text: "30",
    });
    const fat = totalNutrient(summary, "fat", { entryCount: 2, missing: missing.includes("fat") });
    expect(fat).toMatchObject({ state: "partial", text: "≥10" });
    expect(fat.title).toContain("覆盖率");
    expect(totalNutrient(summary, "calories", { entryCount: 2, missing: missing.includes("calories") })).toMatchObject({
      state: "known",
      text: "400",
    });
  });
});

describe("missing nutrient detection", () => {
  it("counts a tiny unknown share as missing even though coverage rounds to 100", () => {
    const entries = [
      meal({ id: "big", nutrition: fullNutrition(300) }),
      meal({ id: "tiny", nutrition: nutrition({ calories: 1 }), consumedRatio: 0.000001 }),
    ];
    const summary = summarizeMeals(entries);
    expect(summary.coverage.fat).toBe(100);
    expect(missingNutrientKeys(entries)).toContain("fat");
  });

  it("ignores voided entries and zero-share entries", () => {
    const entries = [
      meal({ id: "active", nutrition: fullNutrition(300) }),
      meal({ id: "voided", status: "void", nutrition: nutrition({ calories: 100 }) }),
      meal({ id: "zero-share", consumedRatio: 0, nutrition: nutrition({ calories: 100 }) }),
    ];
    expect(missingNutrientKeys(entries)).toEqual([]);
  });
});

describe("meal grouping", () => {
  it("always returns the four meal types in order, including empty ones", () => {
    const groups = groupMealsByType([meal({ id: "lunch", type: "lunch" })]);
    expect(groups.map((group) => group.type)).toEqual(["breakfast", "lunch", "dinner", "snack"]);
    expect(groups.map((group) => group.entries.length)).toEqual([0, 1, 0, 0]);
    expect(groups[1].summary.totals.calories).toBe(300);
  });

  it("keeps each meal total limited to its own entries", () => {
    const types: MealType[] = ["breakfast", "dinner"];
    const groups = groupMealsByType([
      meal({ id: "b", type: types[0], nutrition: nutrition({ calories: 100 }) }),
      meal({ id: "d", type: types[1], nutrition: nutrition({ calories: 500 }) }),
    ]);
    expect(groups[0].summary.totals.calories).toBe(100);
    expect(groups[2].summary.totals.calories).toBe(500);
  });
});

describe("brand display", () => {
  const snapshot = (brand: string) =>
    ({
      definition: { brand },
      version: {},
      quantity: 50,
      unit: "g",
      factor: 1,
      basisQuantity: 100,
    }) as unknown as MealEntry["foodSnapshot"];

  it("hides the brand when the amount label already contains it", () => {
    const entry = meal({ id: "dup", amountLabel: "50克 · 示例品牌", foodSnapshot: snapshot("示例品牌") });
    expect(mealBrand(entry)).toBeUndefined();
  });

  it("shows the brand when the amount label omits it", () => {
    const entry = meal({ id: "new", amountLabel: "50克", foodSnapshot: snapshot("示例品牌") });
    expect(mealBrand(entry)).toBe("示例品牌");
  });

  it("returns undefined when there is no snapshot at all", () => {
    expect(mealBrand(meal({ id: "manual" }))).toBeUndefined();
  });
});
