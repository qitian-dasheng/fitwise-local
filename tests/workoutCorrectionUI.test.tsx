import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WorkoutPage } from "../src/pages/WorkoutPage";
import { initialState } from "../src/domain/seed";
import { useAppStore } from "../src/store/appStore";
import type { WorkoutSession } from "../src/domain/types";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  window.localStorage.clear();
  useAppStore.setState({ ...structuredClone(initialState), workouts: [] });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

function workout(overrides: Partial<WorkoutSession> & { id: string }): WorkoutSession {
  return {
    date: "2026-10-19",
    name: "B4 全身进阶",
    type: "低冲击有氧",
    durationMinutes: 22,
    caloriesKcal: 169,
    averageHeartRate: 125,
    createdAt: "2026-10-19T00:00:00Z",
    ...overrides,
  };
}

async function renderPage(workouts: WorkoutSession[]) {
  await act(async () => {
    useAppStore.setState({ workouts });
    root.render(<WorkoutPage date="2026-10-19" />);
  });
}

const button = (text: string, scope: ParentNode = document) =>
  [...scope.querySelectorAll("button")].find((item) => item.textContent?.includes(text)) as
    | HTMLButtonElement
    | undefined;

const rowFor = (text: string) =>
  [...host.querySelectorAll(".workout-row")].find((item) => item.textContent?.includes(text)) as HTMLElement;

const card = (label: string) =>
  [...host.querySelectorAll(".metric-card")].find((item) => item.textContent?.includes(label)) as HTMLElement;

function setValue(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
}

function fieldByLabel(scope: ParentNode, label: string) {
  const wrapper = [...scope.querySelectorAll("label")].find((item) =>
    item.querySelector("span")?.textContent?.includes(label),
  );
  return wrapper?.querySelector("input, textarea, select") as HTMLInputElement | HTMLTextAreaElement;
}

it("shows an empty state and counts only active records", async () => {
  await renderPage([]);
  expect(host.querySelector(".large-empty")?.textContent).toContain("尚未记录运动");

  await renderPage([
    workout({ id: "a" }),
    workout({ id: "b", name: "多余的记录", status: "void", correctionReason: "重复录入" }),
  ]);
  expect(card("所选日时长").textContent).toContain("22 分钟");
  expect(card("训练次数").textContent).toContain("1 次");
  expect(host.querySelector(".form-hint")?.textContent).toContain("另有 1 条已更正或作废");
});

it("keeps inactive rows visible with their reason and no action buttons", async () => {
  await renderPage([
    workout({ id: "a" }),
    workout({ id: "b", name: "录错的那次", status: "superseded", correctionReason: "把两节课记成一节" }),
  ]);
  const inactive = rowFor("录错的那次");
  expect(inactive.className).toContain("workout-row-inactive");
  expect(inactive.textContent).toContain("已更正");
  expect(inactive.textContent).toContain("把两节课记成一节");
  expect(inactive.querySelector("button")).toBeNull();
  expect(rowFor("B4 全身进阶").querySelectorAll("button")).toHaveLength(2);
});

it("revises a workout through the diff dialog and requires a reason", async () => {
  await renderPage([workout({ id: "a" })]);
  await act(async () => button("编辑")!.click());

  const dialog = document.querySelector(".modal") as HTMLElement;
  expect(dialog.textContent).toContain("更正运动记录");
  expect(dialog.querySelector(".correction-diff")).toBeTruthy();
  expect(dialog.textContent).toContain("22 分钟");

  const submit = button("确认更正")!;
  expect(submit.disabled).toBe(true);

  await act(async () => {
    setValue(fieldByLabel(dialog, "时长（分钟）"), "26");
    setValue(fieldByLabel(dialog, "平均心率"), "148");
  });
  expect(dialog.querySelector(".correction-diff")?.textContent).toContain("26 分钟");

  await act(async () => setValue(fieldByLabel(dialog, "修改／作废原因"), "把时长记成了上一节"));
  await act(async () => {
    const confirmLabel = [...dialog.querySelectorAll("label")].find((item) =>
      item.textContent?.includes("我已核对"),
    )!;
    (confirmLabel.querySelector("input[type=checkbox]") as HTMLInputElement).click();
  });
  await act(async () => button("确认更正", dialog)!.click());

  const stored = useAppStore.getState().workouts;
  expect(stored).toHaveLength(2);
  const old = stored.find((item) => item.id === "a")!;
  expect(old.status).toBe("superseded");
  expect(old.durationMinutes).toBe(22);
  expect(old.correctionReason).toBe("把时长记成了上一节");
  const fresh = stored.find((item) => item.id !== "a")!;
  expect(fresh.durationMinutes).toBe(26);
  expect(fresh.averageHeartRate).toBe(148);
  expect(fresh.supersedesId).toBe("a");
  expect(useAppStore.getState().auditEvents.some((item) => item.eventType === "workout_revised")).toBe(true);
  expect(card("所选日时长").textContent).toContain("26 分钟");
});

it("voids a workout and drops it from the statistics", async () => {
  await renderPage([workout({ id: "a" })]);
  await act(async () => button("作废")!.click());

  const dialog = document.querySelector(".modal") as HTMLElement;
  expect(dialog.textContent).toContain("作废运动记录");
  await act(async () => setValue(fieldByLabel(dialog, "修改／作废原因"), "这节课其实没上"));
  await act(async () => {
    const confirmLabel = [...dialog.querySelectorAll("label")].find((item) =>
      item.textContent?.includes("我已核对"),
    )!;
    (confirmLabel.querySelector("input[type=checkbox]") as HTMLInputElement).click();
  });
  await act(async () => button("确认作废", dialog)!.click());

  const stored = useAppStore.getState().workouts;
  expect(stored).toHaveLength(1);
  expect(stored[0].status).toBe("void");
  expect(useAppStore.getState().auditEvents.some((item) => item.eventType === "workout_voided")).toBe(true);
  expect(card("所选日时长").textContent).toContain("0 分钟");
  expect(card("训练次数").textContent).toContain("0 次");
  expect(rowFor("B4 全身进阶").textContent).toContain("已作废");
});

it("rejects a bad heart rate before writing anything", async () => {
  await renderPage([workout({ id: "a" })]);
  await act(async () => button("编辑")!.click());
  const dialog = document.querySelector(".modal") as HTMLElement;

  await act(async () => setValue(fieldByLabel(dialog, "平均心率"), "300"));
  expect(dialog.textContent).toContain("30–250");
  expect(button("确认更正", dialog)!.disabled).toBe(true);
  expect(useAppStore.getState().workouts).toHaveLength(1);
});

// ===== 0.4.11 填入上次训练 =====

it("fills the new form from the last active workout", async () => {
  await renderPage([workout({ id: "a" })]);
  await act(async () => button("记录运动")!.click());
  const dialog = document.querySelector(".modal") as HTMLElement;

  const fill = button("填入上次训练", dialog)!;
  // 文案必须带来源日期与名称：用户自己判断这条记录还值不值得照抄。
  expect(fill.textContent).toContain("10-19");
  expect(fill.textContent).toContain("B4 全身进阶");
  expect(fill.textContent).toContain("22 分钟");

  await act(async () => fill.click());
  expect(fieldByLabel(dialog, "课程或训练名称").value).toBe("B4 全身进阶");
  expect(fieldByLabel(dialog, "时长（分钟）").value).toBe("22");
  expect(fieldByLabel(dialog, "热量（可选）").value).toBe("169");
  expect(fieldByLabel(dialog, "平均心率（可选）").value).toBe("125");
  // 日期保持当前所选日，不会退回上次那条记录的日期。
  expect(fieldByLabel(dialog, "日期").value).toBe("2026-10-19");
  expect(dialog.textContent).toContain("已填入 10-19 的记录");

  // 复制只带业务字段：sourceFingerprint 一旦被带过去，add_workout 会当成重复直接不写。
  await act(async () => button("确认运动记录", dialog)!.click());
  const created = useAppStore.getState().workouts.find((item) => item.id !== "a")!;
  expect(created.name).toBe("B4 全身进阶");
  expect(created.sourceFingerprint).toBeUndefined();
});

it("skips voided records when suggesting the previous workout", async () => {
  await renderPage([
    workout({ id: "voided", name: "被作废的一次", status: "void", voidedAt: "2026-10-19T03:00:00Z" }),
    workout({
      id: "old",
      name: "更早的那次",
      date: "2026-10-17",
      durationMinutes: 30,
      createdAt: "2026-10-17T00:00:00Z",
    }),
  ]);
  await act(async () => button("记录运动")!.click());
  const dialog = document.querySelector(".modal") as HTMLElement;

  const fill = button("填入上次训练", dialog)!;
  expect(fill.textContent).toContain("10-17");
  expect(fill.textContent).toContain("更早的那次");
  expect(fill.textContent).not.toContain("被作废的一次");
});

it("hides the fill button once the name is typed", async () => {
  await renderPage([workout({ id: "a" })]);
  await act(async () => button("记录运动")!.click());
  const dialog = document.querySelector(".modal") as HTMLElement;
  expect(button("填入上次训练", dialog)).toBeTruthy();

  await act(async () => setValue(fieldByLabel(dialog, "课程或训练名称"), "自己写的课程"));
  expect(button("填入上次训练", dialog)).toBeUndefined();
});
