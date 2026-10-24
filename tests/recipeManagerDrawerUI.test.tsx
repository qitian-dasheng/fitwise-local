import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { RecipeManagerDrawer } from "../src/components/RecipeManagerDrawer";
import { nutrition } from "../src/domain/calculations";
import type { RecipeVersion } from "../src/domain/types";

let container: HTMLDivElement;
let root: Root;
const onSelect = vi.fn();

const recipe = (id: string, name: string, createdAt: string): RecipeVersion => ({
  id,
  recipeId: `r-${id}`,
  name,
  version: 1,
  ingredients: [],
  nutrition: nutrition({ calories: 100, protein: 5 }),
  totalMinutes: 10,
  equipment: [],
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

const optionValues = () => [...container.querySelectorAll<HTMLOptionElement>('select[aria-label="选择标准菜谱"] option')].map((item) => item.value);

it("lists recipes sorted by Chinese name by default", () => {
  // 拼音 collation：白菜(bai) < 燕麦(yan) < 洋葱(yang)。
  expect(optionValues()).toEqual(["rv1", "rv3", "rv2"]);
  expect((container.querySelector('[aria-label="选择标准菜谱"]') as HTMLSelectElement).value).toBe("rv3");
  expect(container.textContent).toContain("匹配 3 道菜");
});

it("filters by name and keeps the selection in sync", async () => {
  const search = container.querySelector<HTMLInputElement>('[aria-label="搜索菜谱名称"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set?.call(search, "燕麦");
    search.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(optionValues()).toEqual(["rv3"]);
  expect(container.textContent).toContain("匹配 1 道菜");
  // 当前选择（燕麦粥）仍匹配，不应回调改选。
  expect(onSelect).not.toHaveBeenCalled();

  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set?.call(search, "白菜");
    search.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(optionValues()).toEqual(["rv1"]);
  // 当前选择被搜掉 → 跟到第一个匹配。
  expect(onSelect).toHaveBeenCalledWith("rv1");
});

it("shows an empty state when nothing matches", async () => {
  const search = container.querySelector<HTMLInputElement>('[aria-label="搜索菜谱名称"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set?.call(search, "不存在");
    search.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(container.querySelector('select[aria-label="选择标准菜谱"]')).toBeNull();
  expect(container.textContent).toContain("没有匹配的菜谱");
});

it("sorts by creation time newest first", async () => {
  const sort = container.querySelector<HTMLSelectElement>('[aria-label="菜谱排序"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set?.call(sort, "recent");
    sort.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(optionValues()).toEqual(["rv3", "rv2", "rv1"]);
});
