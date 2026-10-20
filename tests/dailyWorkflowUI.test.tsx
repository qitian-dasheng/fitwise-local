import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FoodPage } from "../src/pages/FoodPage";
import { WorkoutPage } from "../src/pages/WorkoutPage";
import { TodayPage } from "../src/pages/TodayPage";
import { PlanPage } from "../src/pages/PlanPage";
import { initialState } from "../src/domain/seed";
import { diaryToday, ratioPercent, shiftDiaryDate } from "../src/domain/diary";
import { useAppStore } from "../src/store/appStore";

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  useAppStore.setState(structuredClone(initialState));
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); });
const button = (text: string) => [...container.querySelectorAll("button")].find(item => item.textContent?.includes(text))!;
async function click(text: string) { await act(async () => button(text).click()); }

it("filters workouts by day, weights known heart rates by duration and preserves unknown calories", async () => {
  const date = diaryToday(), yesterday = shiftDiaryDate(date, -1);
  useAppStore.setState({ workouts: [
    { id: "a", date, name: "短训练", type: "步行", durationMinutes: 10, averageHeartRate: 100, createdAt: "" },
    { id: "b", date, name: "长训练", type: "步行", durationMinutes: 30, averageHeartRate: 140, createdAt: "" },
    { id: "c", date: yesterday, name: "昨日不应混入", type: "步行", durationMinutes: 99, caloriesKcal: 900, createdAt: "" },
  ] });
  await act(async () => root.render(<WorkoutPage date={date}/>));
  expect(container.textContent).toContain("40 分钟");
  expect(container.textContent).toContain("130 次/分");
  expect(container.textContent).not.toContain("昨日不应混入");
  expect(container.textContent).toContain("未知");
  expect(container.textContent).not.toContain("0 kcal");
});

it("keeps a food-library basket mounted when visiting one-off entry and returning", async () => {
  await act(async () => root.render(<FoodPage/>));
  await click("添加食物");
  const library = container.querySelector(".food-library")!;
  const search = library.querySelector<HTMLInputElement>('[aria-label="搜索食物或品牌"]')!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search, "燕麦"); search.dispatchEvent(new Event("input", { bubbles: true })); });
  await click("仅记录本次");
  expect(library.closest("[hidden]")).not.toBeNull();
  await click("返回食材库");
  expect(container.querySelector(".food-library")).toBe(library);
  expect(search.value).toBe("燕麦");
});

it("offers a precise all-remaining option even for 0.01 percent", async () => {
  const date = diaryToday();
  useAppStore.setState({ batches: [{ id: "tiny", recipeVersionId: "recipe-pork-tofu-v1", date, inventoryDeducted: true, consumedRatio: .9999, wastedRatio: 0, remainingRatio: .0001, status: "open", ratioIsEstimated: true, createdAt: "" }] });
  await act(async () => root.render(<FoodPage/>));
  await click("记录实际进食");
  expect(button("全部剩余 0.01%")).toBeTruthy();
  const ratio = container.querySelector<HTMLInputElement>('input[min="0.01"]')!;
  expect(ratio.value).toBe("0.01"); expect(ratio.step).toBe("0.01");
  await click("确认写入这一餐");
  expect(useAppStore.getState().batches[0]).toMatchObject({ remainingRatio: 0, consumedRatio: 1, status: "closed" });
});

it("can render an empty recipe/plan store and does not offer an empty day as complete", async () => {
  useAppStore.setState({ recipes: [], plans: [], meals: [], measurements: [], workouts: [], checkIns: [] });
  await act(async () => root.render(<FoodPage/>));
  expect(container.textContent).toContain("暂无标准菜谱");
  await act(async () => root.render(<TodayPage goTo={() => undefined}/>));
  expect(button("确认该日饮食完整").disabled).toBe(true);
});

it("marks seed menus as demonstration and blocks selecting them even with stock", async () => {
  await act(async () => root.render(<PlanPage/>));
  expect(container.textContent).toContain("当前为演示菜单");
  const buttons = [...container.querySelectorAll<HTMLButtonElement>("button")].filter(item => item.textContent?.includes("不可确认为正式菜单"));
  expect(buttons).toHaveLength(3); expect(buttons.every(item => item.disabled)).toBe(true);
  expect(container.textContent).not.toContain("洋葱余量约 400 g");
});

it("reopens only the supplemented diary date and leaves other completed dates alone", async () => {
  const today = diaryToday(), yesterday = shiftDiaryDate(today, -1);
  useAppStore.setState({ checkIns: [{ date: today, complete: true }, { date: yesterday, complete: true, hunger: 3 }] });
  await useAppStore.getState().addMeal({ name: "补记", type: "snack", amountLabel: "一份", calories: 100, protein: 0, date: yesterday });
  expect(useAppStore.getState().checkIns).toEqual([{ date: today, complete: true }, { date: yesterday, complete: false, hunger: 3, completedAt: undefined }]);
  expect(useAppStore.getState().meals.at(-1)?.date).toBe(yesterday);
  await useAppStore.getState().setDayComplete(yesterday, true);
  expect(useAppStore.getState().checkIns[1].complete).toBe(true);
  expect(ratioPercent(.3333)).toBe(33.33);
});
