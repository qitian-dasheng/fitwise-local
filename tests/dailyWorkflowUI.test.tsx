import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FoodPage } from "../src/pages/FoodPage";
import { WorkoutPage } from "../src/pages/WorkoutPage";
import { TodayPage } from "../src/pages/TodayPage";
import { initialState } from "../src/domain/seed";
import { diaryToday, shiftDiaryDate } from "../src/domain/diary";
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

it("can render an empty recipe store and does not offer an empty day as complete", async () => {
  useAppStore.setState({ recipes: [], meals: [], measurements: [], workouts: [], checkIns: [] });
  await act(async () => root.render(<FoodPage/>));
  // 0.9.4 厨房卡压成一行入口后的空态文案。
  expect(container.textContent).toContain("还没有菜谱");
  await act(async () => root.render(<TodayPage goTo={() => undefined}/>));
  expect(button("确认该日完整").disabled).toBe(true);
});

it("keeps the cockpit header free of duplicate copy and keeps the completion discipline visible", async () => {
  await act(async () => root.render(<TodayPage goTo={() => undefined}/>));
  expect(container.textContent).not.toContain("三件事都在这里");
  expect(container.textContent).not.toContain("点了直接开表单");
  // 方向 D：快捷入口是页头三个按钮，主操作只有一个 primary（记一笔）。
  const headerButtons = [...container.querySelectorAll<HTMLButtonElement>(".ui-page-head button")];
  expect(headerButtons.some((item) => item.textContent?.includes("记一笔"))).toBe(true);
  expect(container.querySelectorAll(".ui-page-head .ui-btn.primary").length).toBe(1);
  // 完成确认的纪律文案仍在（不可凭空确认，未知热量日不进均值）。
  expect(container.textContent).toContain("确认前请核对所有餐次");
});

it("reopens only the supplemented diary date and leaves other completed dates alone", async () => {
  const today = diaryToday(), yesterday = shiftDiaryDate(today, -1);
  useAppStore.setState({ checkIns: [{ date: today, complete: true }, { date: yesterday, complete: true, hunger: 3 }] });
  await useAppStore.getState().addMeal({ name: "补记", type: "snack", amountLabel: "一份", calories: 100, protein: 0, date: yesterday });
  expect(useAppStore.getState().checkIns).toEqual([{ date: today, complete: true }, { date: yesterday, complete: false, hunger: 3, completedAt: undefined }]);
  expect(useAppStore.getState().meals.at(-1)?.date).toBe(yesterday);
  await useAppStore.getState().setDayComplete(yesterday, true);
  expect(useAppStore.getState().checkIns[1].complete).toBe(true);
});
