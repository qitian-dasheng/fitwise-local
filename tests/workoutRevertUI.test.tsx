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
  useAppStore.setState({ ...structuredClone(initialState), workouts: [], auditEvents: [] });
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

const dialog = () => document.querySelector(".modal") as HTMLElement;

function setValue(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype =
    element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
}

function fieldByLabel(scope: ParentNode, label: string) {
  const wrapper = [...scope.querySelectorAll("label")].find((item) =>
    item.querySelector("span")?.textContent?.includes(label),
  );
  return wrapper?.querySelector("input, textarea") as HTMLInputElement | HTMLTextAreaElement;
}

/** 一条被更正过的记录：旧行 superseded，新行 active 且指向旧行。 */
function revisedPair(): WorkoutSession[] {
  // 两行的类型刻意不同：默认类型与旧行名字相同，会让 rowFor 认错行。
  return [
    workout({ id: "old", name: "低冲击有氧", type: "旧类型", durationMinutes: 22, status: "superseded", supersededBy: "new", correctionReason: "课程记错了" }),
    workout({ id: "new", type: "新类型", durationMinutes: 26, status: "active", supersedesId: "old", createdAt: "2026-10-19T01:00:00Z" }),
  ];
}

it("offers undo only on a correction that still owns its parent", async () => {
  await renderPage([workout({ id: "plain" })]);
  expect(button("撤销更正", rowFor("B4 全身进阶"))).toBeUndefined();

  await renderPage(revisedPair());
  expect(button("撤销更正", rowFor("B4 全身进阶"))).toBeTruthy();
  // 旧行是「已更正」的中间版本，不能撤销也不能恢复。
  expect(button("撤销更正", rowFor("低冲击有氧"))).toBeUndefined();
  expect(button("恢复", rowFor("低冲击有氧"))).toBeUndefined();
});

it("undoes a correction and puts the parent values back", async () => {
  await renderPage(revisedPair());
  expect(card("所选日时长").textContent).toContain("26 分钟");

  await act(async () => button("撤销更正", rowFor("B4 全身进阶"))!.click());
  expect(dialog().textContent).toContain("恢复为");
  expect(dialog().textContent).toContain("低冲击有氧");

  const confirm = () => button("确认撤销更正", dialog())!;
  expect(confirm().disabled).toBe(true);

  await act(async () => {
    const checkbox = dialog().querySelector('input[type="checkbox"]') as HTMLInputElement;
    checkbox.click();
  });
  // 撤销允许留空原因：勾选之后就该能提交。
  expect(confirm().disabled).toBe(false);

  await act(async () => confirm().click());

  const stored = useAppStore.getState().workouts;
  expect(stored.find((item) => item.id === "old")?.status).toBe("active");
  expect(stored.find((item) => item.id === "new")?.status).toBe("reverted");
  expect(card("所选日时长").textContent).toContain("22 分钟");
  expect(rowFor("B4 全身进阶").textContent).toContain("已撤销更正");
});

it("hides the undo entry once the correction has been undone", async () => {
  await renderPage(revisedPair());
  await act(async () => button("撤销更正", rowFor("B4 全身进阶"))!.click());
  await act(async () => {
    (dialog().querySelector('input[type="checkbox"]') as HTMLInputElement).click();
  });
  await act(async () => button("确认撤销更正", dialog())!.click());

  expect(button("撤销更正")).toBeUndefined();
  expect(rowFor("B4 全身进阶").querySelectorAll("button")).toHaveLength(0);
  // 旧行回到有效，两个按钮（编辑/作废）重新出现，但它的父链已断，没有撤销入口。
  expect(rowFor("低冲击有氧").querySelectorAll("button")).toHaveLength(2);
});

it("restores a voided record and brings its statistics back", async () => {
  await renderPage([
    workout({ id: "gone", name: "被误作废的一次", durationMinutes: 30, status: "void", voidedAt: "2026-10-19T02:00:00Z", correctionReason: "以为重复录入了" }),
  ]);
  expect(card("所选日时长").textContent).toContain("0 分钟");
  expect(button("恢复", rowFor("被误作废的一次"))).toBeTruthy();

  await act(async () => button("恢复", rowFor("被误作废的一次"))!.click());
  const confirm = () => button("确认恢复记录", dialog())!;
  await act(async () => {
    (dialog().querySelector('input[type="checkbox"]') as HTMLInputElement).click();
  });
  // 恢复必须写原因：勾了确认也不能空着提交。
  expect(confirm().disabled).toBe(true);

  await act(async () => setValue(fieldByLabel(dialog(), "恢复原因"), "误点作废"));
  expect(confirm().disabled).toBe(false);
  await act(async () => confirm().click());

  const restored = useAppStore.getState().workouts.find((item) => item.id === "gone")!;
  expect(restored.status).toBe("active");
  expect(restored.voidedAt).toBeUndefined();
  expect(restored.correctionReason).toBe("以为重复录入了");
  expect(restored.restoredReason).toBe("误点作废");
  expect(card("所选日时长").textContent).toContain("30 分钟");
  expect(host.textContent).not.toContain("另有 1 条已更正或作废");
});

it("never offers restore on a superseded row", async () => {
  await renderPage(revisedPair());
  const superseded = rowFor("低冲击有氧");
  expect(superseded.textContent).toContain("已更正");
  expect(superseded.querySelectorAll("button")).toHaveLength(0);
});

it("keeps both snapshots in the audit entry", async () => {
  await renderPage(revisedPair());
  await act(async () => button("撤销更正", rowFor("B4 全身进阶"))!.click());
  await act(async () => {
    (dialog().querySelector('input[type="checkbox"]') as HTMLInputElement).click();
  });
  await act(async () => setValue(fieldByLabel(dialog(), "撤销原因"), "刚才改错了"));
  await act(async () => button("确认撤销更正", dialog())!.click());

  const event = useAppStore.getState().auditEvents.find((item) => item.eventType === "workout_correction_undone")!;
  expect(event).toBeTruthy();
  expect(event.entityId).toBe("old");
  const details = event.payload as {
    before: { head: WorkoutSession; parent: WorkoutSession };
    after: { head: WorkoutSession; parent: WorkoutSession };
    reason: string;
  };
  expect(details.before.head.durationMinutes).toBe(26);
  expect(details.before.parent.durationMinutes).toBe(22);
  expect(details.after.head.status).toBe("reverted");
  expect(details.after.parent.status).toBe("active");
  expect(details.reason).toBe("刚才改错了");
});

it("does not lean on id prefixes in preview mode", async () => {
  await renderPage(revisedPair());
  await act(async () => button("撤销更正", rowFor("B4 全身进阶"))!.click());
  await act(async () => {
    (dialog().querySelector('input[type="checkbox"]') as HTMLInputElement).click();
  });
  await act(async () => button("确认撤销更正", dialog())!.click());

  const stored = useAppStore.getState().workouts;
  // 预览用 uid() 生成 id，撤销只能靠指针，所以行数不变、id 原样保留。
  expect(stored).toHaveLength(2);
  expect(stored.map((item) => item.id).sort()).toEqual(["new", "old"]);
  expect(stored.find((item) => item.id === "old")?.supersededBy).toBeUndefined();
  expect(stored.find((item) => item.id === "old")?.correctedAt).toBeUndefined();
});

it("survives a broken chain without offering undo", async () => {
  await renderPage([
    workout({ id: "orphan", status: "active", supersedesId: "missing-parent", createdAt: "2026-10-19T01:00:00Z" }),
    workout({ id: "mismatch", name: "关系错乱的一条", status: "active", supersedesId: "old", createdAt: "2026-10-19T02:00:00Z" }),
    workout({ id: "old", name: "旧值", status: "superseded", supersededBy: "someone-else" }),
  ]);
  // 父行不存在 → 不渲染；supersededBy 指向别人 → 也不渲染。
  expect(button("撤销更正", rowFor("B4 全身进阶"))).toBeUndefined();
  expect(button("撤销更正", rowFor("关系错乱的一条"))).toBeUndefined();
});
