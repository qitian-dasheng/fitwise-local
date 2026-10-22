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

