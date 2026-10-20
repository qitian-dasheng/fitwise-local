import { beforeEach, describe, expect, it } from "vitest";
import { initialState } from "../src/domain/seed";
import { useAppStore } from "../src/store/appStore";

beforeEach(() => {
  useAppStore.setState(structuredClone(initialState));
});

describe("prepared batch lifecycle", () => {
  it("deducts ingredients once and records meals only after consumption", () => {
    const prepared = useAppStore.getState().prepareRecipe("recipe-pork-tofu-v1");
    expect(prepared.shortage).toEqual([]);
    expect(prepared.batchId).toBeTruthy();
    expect(useAppStore.getState().meals).toHaveLength(0);
    expect(useAppStore.getState().inventoryMovements.filter((item) => item.type === "cooking")).toHaveLength(4);

    const batchId = prepared.batchId!;
    expect(useAppStore.getState().consumeBatch({ batchId, mealType: "lunch", ratio: 0.35, ratioIsEstimated: true })).toEqual({});
    expect(useAppStore.getState().consumeBatch({ batchId, mealType: "dinner", ratio: 0.4, ratioIsEstimated: true })).toEqual({});

    const state = useAppStore.getState();
    const batch = state.batches.find((item) => item.id === batchId)!;
    expect(state.meals.map((item) => [item.type, item.consumedRatio])).toEqual([["lunch", 0.35], ["dinner", 0.4]]);
    expect(batch.consumedRatio).toBe(0.75);
    expect(batch.remainingRatio).toBe(0.25);
    expect(batch.wastedRatio).toBe(0);
  });

  it("keeps leftovers open until the user explicitly discards them", () => {
    const batchId = useAppStore.getState().prepareRecipe("recipe-pork-tofu-v1").batchId!;
    useAppStore.getState().consumeBatch({ batchId, mealType: "lunch", ratio: 0.75, ratioIsEstimated: true });
    expect(useAppStore.getState().batches.find((item) => item.id === batchId)?.status).toBe("open");

    expect(useAppStore.getState().discardBatchRemainder(batchId)).toEqual({});
    const state = useAppStore.getState();
    expect(state.batches.find((item) => item.id === batchId)).toMatchObject({ remainingRatio: 0, wastedRatio: 0.25, status: "closed" });
    expect(state.wasteEvents).toHaveLength(1);
  });
});

describe("body measurement revisions", () => {
  it("retains the previous same-day value as a superseded audit record", () => {
    const date = initialState.measurements[0].date;
    useAppStore.getState().addWeight(82.8, date);
    useAppStore.getState().addWeight(82.6, date);

    const state = useAppStore.getState();
    const sameDay = state.measurements.filter((item) => item.date === date);
    expect(sameDay).toHaveLength(3);
    expect(sameDay.filter((item) => item.status === "active")).toHaveLength(1);
    expect(sameDay.at(-1)?.weightKg).toBe(82.6);
    expect(state.auditEvents.filter((item) => item.entityType === "body_measurement")).toHaveLength(2);
  });
});

describe("persisted state migration", () => {
  it("upgrades version 2 batches and adds event collections without losing records", async () => {
    const legacy = structuredClone(initialState) as unknown as Record<string, unknown>;
    delete legacy.consumptionEvents;
    delete legacy.wasteEvents;
    delete legacy.auditEvents;
    legacy.batches = [{
      id: "legacy-batch",
      recipeVersionId: "recipe-pork-tofu-v1",
      date: initialState.measurements[0].date,
      inventoryDeducted: true,
      consumedRatio: 0.75,
      wastedRatio: 0.25,
      ratioIsEstimated: true,
      createdAt: "2026-10-20T00:00:00Z",
    }];
    localStorage.setItem("fitwise-app-state-v1", JSON.stringify({ state: legacy, version: 2 }));

    await useAppStore.persist.rehydrate();
    const state = useAppStore.getState();
    expect(state.inventory).toHaveLength(initialState.inventory.length);
    expect(state.batches[0]).toMatchObject({ id: "legacy-batch", remainingRatio: 0, status: "closed" });
    expect(state.consumptionEvents).toEqual([]);
    expect(state.wasteEvents).toEqual([]);
    expect(state.auditEvents).toEqual([]);
  });
});

