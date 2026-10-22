import { describe, expect, it } from "vitest";
import { mealCopySource } from "../src/domain/meals";
import { nutrition } from "../src/domain/calculations";
import type { MealEntry } from "../src/domain/types";

const entry = (overrides: Partial<MealEntry> & { id: string; date: string }): MealEntry => ({
  type: "breakfast",
  name: overrides.id,
  amountLabel: "一份",
  nutrition: nutrition({ calories: 300, protein: 10 }),
  consumedRatio: 1,
  source: "manual",
  confidence: "high",
  createdAt: `${overrides.date}T08:00:00+08:00`,
  ...overrides,
});

describe("mealCopySource 照搬来源", () => {
  it("取目标日期之前最近的一天", () => {
    const source = mealCopySource(
      [
        entry({ id: "a", date: "2026-10-18" }),
        entry({ id: "b", date: "2026-10-20" }),
        entry({ id: "c", date: "2026-10-21" }),
      ],
      "breakfast",
      "2026-10-22",
    );
    expect(source?.date).toBe("2026-10-21");
    expect(source?.entries).toHaveLength(1);
  });

  it("只有同餐次的记录才算来源", () => {
    const source = mealCopySource(
      [entry({ id: "lunch", date: "2026-10-21", type: "lunch" })],
      "breakfast",
      "2026-10-22",
    );
    expect(source).toBeNull();
  });

  it("不拿目标日期当天或更晚的记录当来源", () => {
    expect(
      mealCopySource([entry({ id: "today", date: "2026-10-22" })], "breakfast", "2026-10-22"),
    ).toBeNull();
    expect(
      mealCopySource([entry({ id: "later", date: "2026-10-25" })], "breakfast", "2026-10-22"),
    ).toBeNull();
  });

  it("作废与已更正的条目不参与，整天都废弃时继续往前找", () => {
    const source = mealCopySource(
      [
        entry({ id: "good", date: "2026-10-19" }),
        entry({ id: "void", date: "2026-10-20", status: "void" }),
        entry({ id: "superseded", date: "2026-10-21", status: "superseded" }),
      ],
      "breakfast",
      "2026-10-22",
    );
    expect(source?.date).toBe("2026-10-19");
    expect(source?.entries.map((item) => item.id)).toEqual(["good"]);
  });

  it("热量按进食比例折算，全已知才给数字", () => {
    const source = mealCopySource(
      [
        entry({ id: "half", date: "2026-10-21", consumedRatio: 0.5 }),
        entry({ id: "full", date: "2026-10-21", nutrition: nutrition({ calories: 200, protein: 5 }) }),
      ],
      "breakfast",
      "2026-10-22",
    );
    // 300 × 0.5 + 200 = 350
    expect(source?.calories).toBe(350);
  });

  it("有未知热量时合计返回 null，不按 0 摊薄", () => {
    const unknown: MealEntry = entry({ id: "unknown", date: "2026-10-21" });
    unknown.nutrition = {
      ...unknown.nutrition,
      calories: { state: "unknown", unit: "kcal", source: "manual", confidence: "low" },
    };
    const source = mealCopySource([unknown], "breakfast", "2026-10-22");
    expect(source?.calories).toBeNull();
    expect(source?.entries).toHaveLength(1);
  });
});
