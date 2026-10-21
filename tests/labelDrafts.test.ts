import { expect, it } from "vitest";
import { emptyLabelForm, previewLabel } from "../src/domain/labelDrafts";

const sample = () => ({ ...emptyLabelForm(), name: "酸奶", nutrients: { ...emptyLabelForm().nutrients, calories: "418.4", protein: "0" } });
it("normalizes kJ, preserves original energy, zero and unknown", () => {
  const f = sample(), p = previewLabel(f);
  expect(p.nutrition.calories.value).toBeCloseTo(100); expect(p.input.nutrients.calories).toBe(418.4);
  expect(p.nutrition.protein.state).toBe("zero"); expect(p.nutrition.fiber.state).toBe("unknown"); expect(p.nutrition.fiber.value).toBeUndefined();
});
it("normalizes sodium grams to milligrams without changing raw draft", () => {
  const f = sample(); f.sodiumUnit = "g"; f.nutrients.sodium = "0.12";
  expect(previewLabel(f).nutrition.sodium.value).toBe(120); expect(f.nutrients.sodium).toBe("0.12");
});
it("derives grams only through explicit confirmed package conversion", () => {
  const f = sample(); f.basisQuantity = "1"; f.basisUnit = "package"; f.netQuantity = "200";
  expect(previewLabel(f).per100g).toBeUndefined();
  f.conversions = [{ unit: "g", quantity: "200", basisQuantity: "1" }];
  expect(previewLabel(f).per100g?.calories.value).toBeCloseTo(50);
  expect(previewLabel(f).per100ml).toBeUndefined();
});
it("allows kg versus g drained checks, refuses volume density assumptions", () => {
  const f = sample(); f.netQuantity = "1"; f.netUnit = "kg"; f.drainedQuantity = "800";
  expect(() => previewLabel(f)).not.toThrow();
  f.drainedQuantity = "1001"; expect(() => previewLabel(f)).toThrow("不能大于");
  f.drainedQuantity = "800"; f.netUnit = "ml"; expect(() => previewLabel(f)).toThrow("不猜测密度");
});
it("blocks kJ-as-kcal and decimal ambiguity, not silently repairing", () => {
  const f = sample(); f.energyUnit = "kcal"; f.nutrients.calories = "1600";
  expect(() => previewLabel(f)).toThrow("千焦");
  for (const value of ["1,200", "1e2", "10-20", "NaN", "-1", "."]) { f.nutrients.calories = value; expect(() => previewLabel(f)).toThrow(); }
});
it("allows high energy per large package without inventing a mass reference", () => {
  const f = sample(); f.basisQuantity = "1"; f.basisUnit = "package"; f.energyUnit = "kcal"; f.nutrients.calories = "2000";
  expect(previewLabel(f).nutrition.calories.value).toBe(2000); expect(previewLabel(f).per100g).toBeUndefined();
});
it("requires one known nutrient, positive basis, nonduplicate conversion units", () => {
  expect(() => previewLabel({ ...emptyLabelForm(), name: "未知标签" })).toThrow("至少核对");
  const f = sample(); f.basisQuantity = "0"; expect(() => previewLabel(f)).toThrow();
  f.basisQuantity = "100"; f.conversions = [{ unit: "g", quantity: "1", basisQuantity: "1" }]; expect(() => previewLabel(f)).toThrow("重复");
});
