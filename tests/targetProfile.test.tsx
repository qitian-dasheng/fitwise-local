import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import { SettingsPage } from "../src/pages/SettingsPage";
import { initialState } from "../src/domain/seed";
import { useAppStore } from "../src/store/appStore";
import { validateTargetProfileInput } from "../src/domain/targets";
import type { TargetProfileInput } from "../src/domain/types";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  window.localStorage.clear();
  useAppStore.setState(structuredClone(initialState));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

const valid: TargetProfileInput = {
  dailyCalories: { min: 1700, target: 1800, max: 1900 },
  proteinTargetG: 100,
  fiberTargetG: 25,
  targetWeightKg: 78.9,
};

const button = (text: string) =>
  [...host.querySelectorAll("button")].find((item) => item.textContent?.includes(text)) as HTMLButtonElement;
const input = (label: string) =>
  [...host.querySelectorAll("label")].find((item) => item.textContent?.includes(label))?.querySelector("input") as HTMLInputElement;

async function fill(element: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

it("validates the target mirror with the same rules as Rust", () => {
  expect(validateTargetProfileInput(valid).error).toBeUndefined();
  expect(validateTargetProfileInput({ ...valid, dailyCalories: { min: 1900, target: 1800, max: 1700 } }).error).toContain("下限 ≤ 目标 ≤ 上限");
  expect(validateTargetProfileInput({ ...valid, dailyCalories: { min: 100, target: 1800, max: 1900 } }).error).toContain("500–8000");
  expect(validateTargetProfileInput({ ...valid, proteinTargetG: 0 }).error).toContain("蛋白质目标");
  expect(validateTargetProfileInput({ ...valid, fiberTargetG: 300 }).error).toContain("纤维目标");
  expect(validateTargetProfileInput({ ...valid, targetWeightKg: 78.555 }).error).toContain("两位小数");
  expect(validateTargetProfileInput(valid).payload).toEqual(valid);
});

it("edits targets from the settings page and keeps an audit trail", async () => {
  await act(async () => { root.render(<SettingsPage />); });
  // 0.9.4 设置行 + 弹窗：先开「个人目标」弹窗，再进编辑表单。
  await act(async () => button("个人目标").click());
  expect(host.querySelector(".modal")).not.toBeNull();
  await act(async () => button("编辑目标").click());
  expect(input("热量下限 kcal").value).toBe("1700");
  await fill(input("蛋白质目标 g"), "120");
  await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  const state = useAppStore.getState();
  expect(state.profile.proteinTargetG).toBe(120);
  expect(state.profile.dailyCalories.target).toBe(1800);
  const events = state.auditEvents.filter((item) => item.eventType === "target_profile_updated");
  expect(events).toHaveLength(1);
  const details = (events[0].payload as { details: { before: { proteinTargetG: number }; after: { proteinTargetG: number } } }).details;
  expect(details.before.proteinTargetG).toBe(100);
  expect(details.after.proteinTargetG).toBe(120);
  // 保存成功后编辑表单收起，弹窗内展示新值；设置行摘要同步。
  expect(host.querySelector("form")).toBeNull();
  expect(host.textContent).toContain("120 g / 25 g");
  expect(host.textContent).toContain("蛋白 120 g");
});

it("rejects a disordered range client-side without touching the store", async () => {
  await act(async () => { root.render(<SettingsPage />); });
  await act(async () => button("个人目标").click());
  await act(async () => button("编辑目标").click());
  await fill(input("热量下限 kcal"), "2000");
  await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(host.textContent).toContain("下限 ≤ 目标 ≤ 上限");
  expect(useAppStore.getState().profile.dailyCalories.min).toBe(1700);
  expect(useAppStore.getState().auditEvents.filter((item) => item.eventType === "target_profile_updated")).toHaveLength(0);
});
