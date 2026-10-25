import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { RecipeManagerDrawer } from "../src/components/RecipeManagerDrawer";
import { nutrition } from "../src/domain/calculations";
import type { RecipeVersion } from "../src/domain/types";

let container: HTMLDivElement;
let root: Root;
const onSelect = vi.fn();

const recipe = (id: string, name: string, createdAt: string, mealTags?: RecipeVersion["mealTags"]): RecipeVersion => ({
  id,
  recipeId: `r-${id}`,
  name,
  version: 1,
  ingredients: [],
  nutrition: nutrition({ calories: 100, protein: 5 }),
  totalMinutes: 10,
  equipment: [],
  ...(mealTags ? { mealTags } : {}),
  source: "personal",
  createdAt,
});

const recipes = [
  recipe("rv1", "白菜豆腐锅", "2026-10-20T00:00:00Z"),
  recipe("rv2", "洋葱牛肉", "2026-10-21T00:00:00Z"),
  recipe("rv3", "燕麦粥", "2026-10-22T00:00:00Z"),
];

function render(overrides: Partial<Parameters<typeof RecipeManagerDrawer>[0]> = {}) {
  return act(async () => {
    root.render(
      <RecipeManagerDrawer
        recipes={recipes}
        latest={recipes}
        options={recipes}
        recipe={recipes[2]}
        showHistory={false}
        onShowHistoryChange={() => undefined}
        onSelect={onSelect}
        onNew={() => undefined}
        onRevise={() => undefined}
        onCopy={() => undefined}
        onAddToMeal={() => undefined}
        onClose={() => undefined}
        {...overrides}
      />,
    );
  });
}

beforeEach(async () => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  onSelect.mockReset();
  await render();
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); });

// 0.9.4 第三轮：原生下拉改为可滚列表；顺序断言走 .recipe-list-item。
const itemValues = () => [...container.querySelectorAll(".recipe-list-item strong")].map((item) => item.textContent);
const activeItem = () => container.querySelector(".recipe-list-item.active strong")?.textContent;
const groupLabels = () => [...container.querySelectorAll(".recipe-list-group")].map((group) => group.textContent);

it("lists recipes sorted by Chinese name by default", () => {
  // 拼音 collation：白菜(bai) < 燕麦(yan) < 洋葱(yang)。
  // 按名称序：白菜豆腐锅 < 燕麦粥 < 洋葱牛肉。
  expect(itemValues()).toEqual(["白菜豆腐锅", "燕麦粥", "洋葱牛肉"]);
  expect(container.textContent).toContain("匹配 3 道菜");
  // 当前选择高亮。
  expect(activeItem()).toContain("燕麦粥");
});

it("filters by name and keeps the selection in sync", async () => {
  const search = container.querySelector<HTMLInputElement>('[aria-label="搜索菜谱名称"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set?.call(search, "燕麦");
    search.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(itemValues()).toEqual(["燕麦粥"]);
  expect(container.textContent).toContain("匹配 1 道菜");
  // 当前选择（燕麦粥）仍匹配，不应回调改选。
  expect(onSelect).not.toHaveBeenCalled();

  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set?.call(search, "白菜");
    search.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(itemValues()).toEqual(["白菜豆腐锅"]);
  // 当前选择被搜掉 → 跟到第一个匹配。
  expect(onSelect).toHaveBeenCalledWith("rv1");
});

it("shows an empty state when nothing matches", async () => {
  const search = container.querySelector<HTMLInputElement>('[aria-label="搜索菜谱名称"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set?.call(search, "不存在");
    search.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(container.querySelectorAll(".recipe-list-item")).toHaveLength(0);
  expect(container.textContent).toContain("没有匹配的菜谱");
});

it("sorts by creation time newest first", async () => {
  const sort = container.querySelector<HTMLSelectElement>('[aria-label="菜谱排序"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set?.call(sort, "recent");
    sort.dispatchEvent(new Event("change", { bubbles: true }));
  });
  // 列表按时间序渲染：燕麦粥(22) → 洋葱牛肉(21) → 白菜豆腐锅(20)。
  expect(itemValues()).toEqual(["燕麦粥", "洋葱牛肉", "白菜豆腐锅"]);
});

// ── OBS-010（0.9.4）：按适用餐次筛选 + 分组下拉 ──────────────────

const filterSelect = () => container.querySelector<HTMLSelectElement>('[aria-label="按餐次筛选"]')!;
const setSelect = (select: HTMLSelectElement, value: string) => act(async () => {
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set?.call(select, value);
  select.dispatchEvent(new Event("change", { bubbles: true }));
});

it("groups the dropdown by meal tags with an unlabeled fallback", async () => {
  const tagged = [
    recipe("rv1", "白菜豆腐锅", "2026-10-20T00:00:00Z", ["lunch", "dinner"]),
    recipe("rv2", "燕麦粥", "2026-10-22T00:00:00Z", ["breakfast"]),
    recipe("rv3", "随便炖", "2026-10-21T00:00:00Z"),
  ];
  await render({ recipes: tagged, latest: tagged, options: tagged, recipe: tagged[1] });
  // 分组顺序按餐次固定；多标签菜谱（白菜豆腐锅）出现在午餐与晚餐两组。
  expect(groupLabels()).toEqual(["早餐", "午餐", "晚餐", "未分类"]);
  const lunchGroup = [...container.querySelectorAll(".recipe-list-group")].find((group) => group.textContent === "午餐")!.parentElement!;
  expect([...lunchGroup.querySelectorAll(".recipe-list-item strong")].map((item) => item.textContent)).toEqual(["白菜豆腐锅"]);
  expect(container.textContent).toContain("适用 早餐");
});

it("filters by meal and falls back to the first match when the selection is filtered out", async () => {
  const tagged = [
    recipe("rv1", "白菜豆腐锅", "2026-10-20T00:00:00Z", ["lunch"]),
    recipe("rv2", "燕麦粥", "2026-10-22T00:00:00Z", ["breakfast"]),
  ];
  await render({ recipes: tagged, latest: tagged, options: tagged, recipe: tagged[1] });
  await setSelect(filterSelect(), "lunch");
  expect(itemValues()).toEqual(["白菜豆腐锅"]);
  // 当前选择（早餐的燕麦粥）被筛掉 → 跟到第一个匹配（午餐的白菜豆腐锅）。
  expect(onSelect).toHaveBeenCalledWith("rv1");

  await setSelect(filterSelect(), "unlabeled");
  expect(container.querySelectorAll(".recipe-list-item")).toHaveLength(0);
  expect(container.textContent).toContain("没有匹配的菜谱");

  await setSelect(filterSelect(), "all");
  // 「全部」仍按分组展示：早餐组（燕麦粥）在前、午餐组（白菜豆腐锅）在后。
  expect(groupLabels()).toEqual(["早餐", "午餐"]);
  expect(itemValues()).toEqual(["燕麦粥", "白菜豆腐锅"]);
});
