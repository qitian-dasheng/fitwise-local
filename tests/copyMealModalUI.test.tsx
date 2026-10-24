import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CopyMealModal } from "../src/components/CopyMealModal";
import { nutrition } from "../src/domain/calculations";
import { mealCopySource } from "../src/domain/meals";
import { initialState } from "../src/domain/seed";
import type { MealEntry } from "../src/domain/types";
import { useAppStore } from "../src/store/appStore";

const entry = (id: string, date: string, calories: number): MealEntry => ({
  id,
  date,
  type: "breakfast",
  name: `${date} 早餐`,
  amountLabel: "一份",
  nutrition: nutrition({ calories, protein: 10 }),
  consumedRatio: 1,
  source: "manual",
  confidence: "high",
  createdAt: `${date}T08:00:00+08:00`,
});

let container: HTMLDivElement;
let root: Root;
const closed = vi.fn();
let copyMeal: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  useAppStore.setState({
    ...structuredClone(initialState),
    meals: [entry("m1", "2026-10-18", 300), entry("m2", "2026-10-20", 400), entry("m3", "2026-10-21", 500)],
    copyMeal: (copyMeal = vi.fn().mockResolvedValue({})),
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  closed.mockReset();
  const source = mealCopySource(useAppStore.getState().meals, "breakfast", "2026-10-22")!;
  expect(source.date).toBe("2026-10-21");
  await act(async () => {
    root.render(<CopyMealModal date="2026-10-22" type="breakfast" source={source} onClose={closed} />);
  });
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); });

it("defaults to the latest source day and can switch to an earlier one", async () => {
  expect(container.textContent).toContain("来自 2026-10-21 的早餐");
  expect(container.textContent).toContain("500");
  expect(container.querySelectorAll("option")).toHaveLength(3);
  expect([...container.querySelectorAll("option")].map((item) => item.value)).toEqual(["2026-10-21", "2026-10-20", "2026-10-18"]);

  const select = container.querySelector("select")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set?.call(select, "2026-10-20");
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(container.textContent).toContain("来自 2026-10-20 的早餐");
  expect(container.textContent).toContain("400");

  await act(async () => { container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  expect(copyMeal).toHaveBeenCalledTimes(1);
  expect(copyMeal.mock.calls[0][0]).toMatchObject({ date: "2026-10-22", type: "breakfast", sourceDate: "2026-10-20" });
  expect(closed).toHaveBeenCalledTimes(1);
});

it("keeps the same command id when the same source is retried after a failure", async () => {
  copyMeal.mockResolvedValueOnce({ error: "保存失败" });
  await act(async () => { container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  expect(container.textContent).toContain("保存失败");
  await act(async () => { container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  expect(copyMeal.mock.calls[0][1]).toBe(copyMeal.mock.calls[1][1]);
});
