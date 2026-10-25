import { describe, expect, it } from "vitest";
import { calorieBudget, recordStreak } from "../src/domain/todayHints";
import { frequentFoods, lastPortionForVersion } from "../src/domain/meals";
import type { DailyCheckIn, FoodDefinition, FoodDefinitionVersion, MealEntry, NutritionFacts } from "../src/domain/types";

const known = (value: number, unit: "kcal" | "g" | "mg" = "kcal") => ({ state: "known" as const, value, unit, source: "manual" as const, confidence: "high" as const });
const facts = (calories: number | null): NutritionFacts => ({
  calories: calories === null ? { state: "unknown", unit: "kcal", source: "manual", confidence: "low" } : known(calories),
  protein: known(30, "g"), carbohydrates: known(100, "g"), fat: known(30, "g"),
  fiber: known(10, "g"), sugar: known(5, "g"), sodium: known(800, "mg"),
});

let sequence = 0;
function meal(date: string, overrides: Partial<MealEntry> = {}): MealEntry {
  sequence += 1;
  return {
    id: `meal-${sequence}`, date, type: "breakfast", name: "测试餐", amountLabel: "1 份",
    nutrition: facts(500), consumedRatio: 1, source: "manual", confidence: "high",
    createdAt: `${date}T08:00:00+08:00`, ...overrides,
  };
}

describe("calorieBudget（还能吃多少）", () => {
  const range = { min: 1700, target: 1800, max: 1900 };
  it("没有记录时只展示区间，不给剩余", () => {
    expect(calorieBudget(0, 0, range, false).status).toBe("no-records");
  });
  it("热量全知且低于区间时给出剩余区间", () => {
    const budget = calorieBudget(1500, 100, range, true);
    expect(budget.status).toBe("known");
    expect(budget.remainingLow).toBe(200);
    expect(budget.remainingHigh).toBe(400);
  });
  it("热量全知且超上限时报超出量", () => {
    const budget = calorieBudget(2000, 100, range, true);
    expect(budget.status).toBe("over");
    expect(budget.overBy).toBe(100);
  });
  it("仍有未知热量时只给上界，不给下界", () => {
    const budget = calorieBudget(1500, 60, range, true);
    expect(budget.status).toBe("partial");
    expect(budget.remainingLow).toBeNull();
    expect(budget.remainingHigh).toBe(400);
  });
});

describe("recordStreak（连续记录天数）", () => {
  const check = (date: string): DailyCheckIn => ({ date, complete: true });
  it("今天还没记不打断连击，从昨天往回数", () => {
    const meals = [meal("2026-10-20"), meal("2026-10-19")];
    expect(recordStreak(meals, [], "2026-10-21")).toBe(2);
  });
  it("今天记了就从今天数起", () => {
    expect(recordStreak([meal("2026-10-21"), meal("2026-10-20")], [], "2026-10-21")).toBe(2);
  });
  it("中间断一天就停", () => {
    const meals = [meal("2026-10-21"), meal("2026-10-18")];
    expect(recordStreak(meals, [], "2026-10-21")).toBe(1);
  });
  it("作废记录不算数，完成日打卡也算记录", () => {
    const meals = [meal("2026-10-21", { status: "void" })];
    expect(recordStreak(meals, [check("2026-10-21"), check("2026-10-20")], "2026-10-21")).toBe(2);
  });
});

describe("frequentFoods / lastPortionForVersion（常吃榜与上次份量）", () => {
  const definition = (id: string, versionId: string) => ({ id, name: id, activeVersionId: versionId, measurementBasis: "packaged" }) as unknown as FoodDefinition;
  const version = (id: string, foodId: string) => ({ id, foodId, version: 1, basis: { quantity: 100, unit: "g" }, conversions: [], labelNutrients: {}, nutrition: facts(null), energyUnit: "kcal", source: "label" }) as unknown as FoodDefinitionVersion;
  const defs = [definition("food-oat", "ver-oat"), definition("food-egg", "ver-egg")];
  const versions = [version("ver-oat", "food-oat"), version("ver-egg", "food-egg")];

  it("按窗口内频次排序，窗口外不计", () => {
    const meals = [
      meal("2026-10-21", { foodVersionId: "ver-oat" }),
      meal("2026-10-20", { foodVersionId: "ver-oat" }),
      meal("2026-10-19", { foodVersionId: "ver-egg" }),
      meal("2026-09-10", { foodVersionId: "ver-egg" }), // 30 天窗口外
    ];
    const top = frequentFoods(meals, defs, versions, "2026-10-21");
    expect(top.map((item) => item.definition.id)).toEqual(["food-oat", "food-egg"]);
    expect(top[0].count).toBe(2);
    expect(top[1].count).toBe(1);
  });
  it("上次份量取最近一次有效记录，忽略作废", () => {
    const meals = [
      meal("2026-10-19", { foodVersionId: "ver-oat", status: "void", foodSnapshot: { definition: defs[0], version: versions[0], quantity: 30, unit: "g", factor: 0.3, basisQuantity: 100 } }),
      meal("2026-10-20", { foodVersionId: "ver-oat", foodSnapshot: { definition: defs[0], version: versions[0], quantity: 40, unit: "g", factor: 0.4, basisQuantity: 100 } }),
    ] as MealEntry[];
    const last = lastPortionForVersion(meals, "ver-oat");
    expect(last).toMatchObject({ quantity: 40, unit: "g", date: "2026-10-20" });
    expect(frequentFoods(meals, defs, versions, "2026-10-21")[0].lastPortion?.quantity).toBe(40);
  });
  it("无历史时 lastPortion 为 null，不猜默认值", () => {
    const meals = [meal("2026-10-21", { foodVersionId: "ver-egg" })];
    expect(frequentFoods(meals, defs, versions, "2026-10-21")[0].lastPortion).toBeNull();
  });
});
