import { describe, expect, it } from "vitest";
import {
  completedDayCalorieAverage,
  activeMeasurements,
  deductInventoryFEFO,
  movingAverage,
  nutrition,
  summarizeMeals,
} from "../src/domain/calculations";
import type { InventoryLot, MealEntry } from "../src/domain/types";

function meal(id: string, calories: number | undefined, ratio = 1): MealEntry {
  return {
    id,
    date: "2026-10-20",
    type: "lunch",
    name: id,
    amountLabel: "测试份量",
    nutrition: nutrition({ calories, protein: calories === undefined ? undefined : 20 }),
    consumedRatio: ratio,
    source: "manual",
    confidence: "high",
    createdAt: "2026-10-20T00:00:00Z",
  };
}

describe("nutrition summaries", () => {
  it("counts only the consumed ratio of a shared batch", () => {
    const result = summarizeMeals([meal("batch", 883, 0.75)]);
    expect(result.totals.calories).toBeCloseTo(662.25);
    expect(result.coverage.calories).toBe(100);
  });

  it("keeps unknown nutrients distinct from zero", () => {
    const result = summarizeMeals([meal("known", 500), meal("unknown", undefined)]);
    expect(result.totals.calories).toBe(500);
    expect(result.coverage.calories).toBe(50);
  });

  it("excludes incomplete days from calorie averages", () => {
    const entries = [
      meal("complete", 1800),
      { ...meal("incomplete", 600), id: "incomplete", date: "2026-10-21" },
    ];
    const average = completedDayCalorieAverage(entries, [
      { date: "2026-10-20", complete: true },
      { date: "2026-10-21", complete: false },
    ]);
    expect(average).toBe(1800);
  });
});

describe("inventory FEFO", () => {
  const lot = (id: string, remainingAmount: number, expiresAt: string, opened = false): InventoryLot => ({
    id,
    foodId: "tofu",
    name: "豆腐",
    purchasedAmount: remainingAmount,
    remainingAmount,
    unit: "g",
    purchasePriceCny: 5,
    purchasedAt: "2026-10-20",
    expiresAt,
    opened,
    confidence: "high",
  });

  it("deducts opened lots before later unopened lots", () => {
    const result = deductInventoryFEFO(
      [lot("later-open", 100, "2026-10-25", true), lot("early-closed", 100, "2026-10-21")],
      "tofu",
      150,
    );
    expect(result.deductions).toEqual([
      { lotId: "later-open", amount: 100 },
      { lotId: "early-closed", amount: 50 },
    ]);
    expect(result.lots.find((item) => item.id === "early-closed")?.remainingAmount).toBe(50);
    expect(result.shortage).toBe(0);
  });

  it("reports shortages without creating negative inventory", () => {
    const result = deductInventoryFEFO([lot("only", 100, "2026-10-21")], "tofu", 300);
    expect(result.shortage).toBe(200);
    expect(result.lots[0].remainingAmount).toBe(0);
  });
});

describe("weight trends", () => {
  it("computes a rolling average without requiring seven initial days", () => {
    const result = movingAverage([
      { date: "1", value: 83 },
      { date: "2", value: 82 },
      { date: "3", value: 81 },
    ], 2);
    expect(result.map((item) => item.value)).toEqual([83, 82.5, 81.5]);
  });

  it("uses only active revisions in trend calculations", () => {
    const result = activeMeasurements([
      { id: "old", date: "2026-10-20", weightKg: 83, status: "superseded", createdAt: "2026-10-20T01:00:00Z" },
      { id: "new", date: "2026-10-20", weightKg: 82.8, status: "active", supersedesId: "old", createdAt: "2026-10-20T02:00:00Z" },
    ]);
    expect(result.map((item) => item.id)).toEqual(["new"]);
  });
});
