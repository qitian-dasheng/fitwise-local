import { beforeEach, describe, expect, it } from "vitest";
import { createPersonalState, initialState } from "../src/domain/seed";
import { useAppStore } from "../src/store/appStore";

beforeEach(() => {
  useAppStore.setState(structuredClone(initialState));
});

it("desktop onboarding does not seed fictional measurements or data", () => {
  const state = createPersonalState();
  expect(state.measurements).toEqual([]);
  expect(state.checkIns).toEqual([]);
  expect(state.recipes).toHaveLength(1);
});

describe("body measurement revisions", () => {
  it("keeps every same-day weigh-in active and appends audit events", async () => {
    const date = initialState.measurements[0].date;
    const before = useAppStore.getState().measurements.filter((item) => item.date === date).length;
    const auditBefore = useAppStore.getState().auditEvents.filter((item) => item.entityType === "body_measurement").length;
    await useAppStore.getState().addWeight(82.8, date);
    await useAppStore.getState().addWeight(82.6, date);

    const state = useAppStore.getState();
    const sameDay = state.measurements.filter((item) => item.date === date);
    expect(sameDay).toHaveLength(before + 2);
    const added = sameDay.filter((item) => item.weightKg === 82.8 || item.weightKg === 82.6);
    expect(added).toHaveLength(2);
    expect(added.every((item) => item.status === "active")).toBe(true);
    expect(added.every((item) => item.supersedesId === undefined)).toBe(true);
    expect(state.auditEvents.filter((item) => item.entityType === "body_measurement")).toHaveLength(auditBefore + 2);
  });

  it("records time and condition, then keeps revise, void and representative auditable", async () => {
    const date = "2026-10-19";
    await useAppStore.getState().recordWeight({ weightKg: 83.2, date, time: "06:30", condition: "morning" });
    const morning = useAppStore.getState().measurements.find((item) => item.weightKg === 83.2)!;
    expect(morning).toMatchObject({ date, condition: "morning" });
    expect(morning.measuredAt).toBe("2026-10-19T06:30:00+08:00");

    await useAppStore.getState().recordWeight({ weightKg: 82.9, date, time: "21:10", condition: "other" });
    const evening = useAppStore.getState().measurements.find((item) => item.weightKg === 82.9)!;
    expect(evening.id).not.toBe(morning.id);
    expect(evening.status).toBe("active");

    await useAppStore.getState().setWeightRepresentative(morning.id);
    let state = useAppStore.getState();
    expect(state.measurements.find((item) => item.id === morning.id)?.dayRepresentative).toBe(true);
    expect(state.measurements.find((item) => item.id === evening.id)?.dayRepresentative).toBeUndefined();

    await useAppStore.getState().reviseWeight({
      measurementId: evening.id,
      weightKg: 82.7,
      date,
      time: "21:10",
      reason: "秤没归零，重新称了",
    });
    state = useAppStore.getState();
    expect(state.measurements.find((item) => item.id === evening.id)?.status).toBe("superseded");
    const fresh = state.measurements.find((item) => item.supersedesId === evening.id)!;
    expect(fresh).toMatchObject({ status: "active", weightKg: 82.7 });

    expect(await useAppStore.getState().voidWeight({ measurementId: fresh.id, reason: "重复录入" })).toEqual({});
    state = useAppStore.getState();
    expect(state.measurements.find((item) => item.id === fresh.id)?.status).toBe("void");
    expect(state.auditEvents.map((item) => item.eventType)).toEqual(
      expect.arrayContaining([
        "body_measurement_created",
        "body_measurement_representative_changed",
        "body_measurement_revised",
        "body_measurement_voided",
      ]),
    );
  });

  it("rejects out-of-range weights, extra decimals and inactive targets", async () => {
    const store = useAppStore.getState();
    expect((await store.recordWeight({ weightKg: 10, date: "2026-10-19" })).error).toContain("20");
    expect((await store.recordWeight({ weightKg: 82.555, date: "2026-10-19" })).error).toContain("两位小数");

    await store.recordWeight({ weightKg: 83, date: "2026-10-19", time: "06:30" });
    const target = useAppStore.getState().measurements.find((item) => item.weightKg === 83)!;
    await useAppStore.getState().voidWeight({ measurementId: target.id, reason: "重复" });
    expect((await useAppStore.getState().reviseWeight({ measurementId: target.id, weightKg: 82, date: "2026-10-19", reason: "改" })).error).toContain("已修订或作废");
    expect((await useAppStore.getState().voidWeight({ measurementId: target.id, reason: "再删" })).error).toContain("已修订或作废");
  });
});

describe("resetDemo", () => {
  const definition = (id: string) => ({
    id, name: `食材-${id}`, measurementBasis: "raw" as const, activeVersionId: `v-${id}`, favorite: false, createdAt: "2026-10-01T00:00:00+08:00",
  });
  const version = (id: string, foodId: string) => ({
    id, foodId, version: 1, basis: { quantity: 100, unit: "g" as const }, energyUnit: "kcal" as const,
    labelNutrients: {}, conversions: [], nutrition: {} as never, source: "personal" as const,
    confirmedBy: "测试", confirmedAt: "2026-10-01T00:00:00+08:00",
  });
  const recipe = (id: string, name: string, foodVersionId: string) => ({
    id, recipeId: id, name, version: 1,
    ingredients: [{ foodId: "food-a", name: "食材甲", amount: 100, unit: "g" as const, measurementBasis: "raw" as const, foodVersionId }],
    nutrition: {} as never, totalMinutes: 20, equipment: ["电磁炉"], source: "personal" as const, createdAt: "2026-10-02T00:00:00+08:00",
  });

  function seedRealisticState() {
    const base = structuredClone(initialState);
    useAppStore.setState({
      profile: { ...base.profile, name: "真实用户", targetWeightKg: 74, proteinTargetG: 160, dailyCalories: { min: 1950, target: 2000, max: 2050 } },
      foodDefinitions: [definition("food-a"), definition("food-b")] as never,
      foodDefinitionVersions: [version("v-food-a", "food-a"), version("v-food-b", "food-b"), version("v-orphan", "food-missing")] as never,
      recipes: [recipe("recipe-valid", "有效菜谱", "v-food-a"), recipe("recipe-dangling", "失效菜谱", "v-none")] as never,
      meals: [
        { id: "meal-1", date: "2026-10-20", type: "lunch", name: "测试午餐" },
        { id: "meal-2", date: "2026-10-21", type: "dinner", name: "测试晚餐" },
      ] as never,
      checkIns: [{ date: "2026-10-20", complete: true }],
      measurements: [{ id: "weight-1", date: "2026-10-20", weightKg: 83.8, status: "active" }] as never,
      workouts: [{ id: "workout-1", date: "2026-10-20", durationMinutes: 22, caloriesKcal: 169, status: "active" }] as never,
      auditEvents: [{ id: "audit-1", eventType: "add_meal", entityType: "meal", payload: {}, createdAt: "2026-10-20T00:00:00+08:00" }] as never,
    });
  }

  it("keeps food library, valid recipes and profile while clearing records", async () => {
    seedRealisticState();
    const summary = await useAppStore.getState().resetDemo();
    const after = useAppStore.getState();

    // 业务记录与审计全部清空。
    expect(after.meals).toEqual([]);
    expect(after.checkIns).toEqual([]);
    expect(after.measurements).toEqual([]);
    expect(after.workouts).toEqual([]);
    expect(after.auditEvents).toEqual([]);
    // 食材库保留，孤儿版本剔除。
    expect(after.foodDefinitions.map((item) => item.id)).toEqual(["food-a", "food-b"]);
    expect(after.foodDefinitionVersions.map((item) => item.id)).toEqual(["v-food-a", "v-food-b"]);
    // 菜谱：有效保留、失效剔除并记名。
    expect(after.recipes.map((item) => item.name)).toEqual(["有效菜谱"]);
    expect(summary.droppedRecipes).toEqual(["失效菜谱"]);
    expect(summary.droppedFoodVersions).toBe(1);
    // 个人目标原样保留。
    expect(after.profile.name).toBe("真实用户");
    expect(after.profile.targetWeightKg).toBe(74);
    expect(after.profile.dailyCalories.target).toBe(2000);
    // 摘要计数。
    expect(summary.keptFoodDefinitions).toBe(2);
    expect(summary.keptRecipes).toBe(1);
    expect(summary.clearedMeals).toBe(2);
    expect(summary.clearedMeasurements).toBe(1);
    expect(summary.clearedWorkouts).toBe(1);
    // 旧数据不复活：持久化快照里不再有测试餐食。
    const persisted = localStorage.getItem("fitwise-app-state-v1") ?? "";
    expect(persisted).not.toContain("测试午餐");
    expect(persisted).not.toContain("weight-1");
  });

  it("keeps display preferences across reset", async () => {
    localStorage.setItem("qingheng.display.energy-unit", "kJ");
    localStorage.setItem("qingheng.food-diary.show-sodium", "1");
    localStorage.setItem("qingheng.trends.range", JSON.stringify({ start: "2026-10-01", end: "2026-10-14" }));

    await useAppStore.getState().resetDemo();

    expect(localStorage.getItem("qingheng.display.energy-unit")).toBe("kJ");
    expect(localStorage.getItem("qingheng.food-diary.show-sodium")).toBe("1");
    expect(localStorage.getItem("qingheng.trends.range")).toBe(JSON.stringify({ start: "2026-10-01", end: "2026-10-14" }));
  });
});

