import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FoodLibraryPage } from "../src/pages/FoodLibraryPage";
import { initialState } from "../src/domain/seed";
import { buildResetState } from "../src/domain/resetState";
import { recipeShortage, isLowStock, pantryStepForUnit, daysUntilExpiry } from "../src/domain/pantry";
import { useAppStore } from "../src/store/appStore";
import type { PantryItem, RecipeVersion } from "../src/domain/types";

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
  vi.restoreAllMocks();
});

const store = () => useAppStore.getState();

/** 种子数据的 foodDefinitions 为空（菜谱用 foodId 直引），食物柜测试自备两条定义。 */
function seedFoods() {
  useAppStore.setState({
    foodDefinitions: [
      { id: "food-tofu", name: "北豆腐", measurementBasis: "raw", activeVersionId: "v-tofu", favorite: false, createdAt: "t" },
      { id: "food-egg", name: "鸡蛋", measurementBasis: "raw", activeVersionId: "v-egg", favorite: false, createdAt: "t" },
    ],
  });
}

describe("食物柜命令镜像（浏览器预览与 Rust 同守卫）", () => {
  it("入库创建条目，增减更新数量，取空提示", async () => {
    seedFoods();
    const created = await store().pantryAdjust({ foodDefinitionId: "food-tofu", delta: 500, unit: "g", lowStockThreshold: 200 });
    expect(created.error).toBeUndefined();
    expect(store().pantryItems).toHaveLength(1);
    expect(store().pantryItems[0]).toMatchObject({ foodDefinitionId: "food-tofu", quantity: 500, unit: "g", lowStockThreshold: 200 });

    await store().pantryAdjust({ foodDefinitionId: "food-tofu", delta: -150.5, unit: "g" });
    expect(store().pantryItems[0].quantity).toBe(349.5);

    const over = await store().pantryAdjust({ foodDefinitionId: "food-tofu", delta: -9999, unit: "g" });
    expect(over.error).toContain("存量");
    expect(store().pantryItems[0].quantity).toBe(349.5);
  });

  it("单位不一致、未知食材与零增量都拒绝", async () => {
    seedFoods();
    await store().pantryAdjust({ foodDefinitionId: "food-tofu", delta: 500, unit: "g" });
    expect((await store().pantryAdjust({ foodDefinitionId: "food-tofu", delta: 1, unit: "piece" })).error).toContain("不一致");
    expect((await store().pantryAdjust({ foodDefinitionId: "food-none", delta: 1, unit: "g" })).error).toContain("建档");
    expect((await store().pantryAdjust({ foodDefinitionId: "food-tofu", delta: 0, unit: "g" })).error).toContain("不能为 0");
    expect((await store().pantryAdjust({ foodDefinitionId: "food-egg", delta: -1, unit: "piece" })).error).toContain("先入库");
  });

  it("更新阈值/到期/备注并支持清空，删除移除条目", async () => {
    seedFoods();
    const { pantryItemId } = await store().pantryAdjust({ foodDefinitionId: "food-tofu", delta: 500, unit: "g" });
    await store().pantryUpdateItem({ id: pantryItemId!, expiresAt: "2026-12-01", lowStockThreshold: 300, note: "冷藏" });
    expect(store().pantryItems[0]).toMatchObject({ expiresAt: "2026-12-01", lowStockThreshold: 300, note: "冷藏" });

    await store().pantryUpdateItem({ id: pantryItemId!, note: null });
    expect("note" in store().pantryItems[0]).toBe(false);

    await store().pantryDeleteItem(pantryItemId!);
    expect(store().pantryItems).toHaveLength(0);
  });
});

describe("食物柜域函数", () => {
  it("低存量、到期与步长口径", () => {
    const item = { id: "p1", foodDefinitionId: "f1", quantity: 100, unit: "g" as const, lowStockThreshold: 200, createdAt: "t", updatedAt: "t" };
    expect(isLowStock(item)).toBe(true);
    expect(isLowStock({ ...item, quantity: 250 })).toBe(false);
    expect(isLowStock({ ...item, quantity: 0, lowStockThreshold: undefined })).toBe(true);
    expect(pantryStepForUnit("g")).toBe(50);
    expect(pantryStepForUnit("piece")).toBe(1);
    expect(daysUntilExpiry({ ...item, expiresAt: "2026-10-28" }, "2026-10-25")).toBe(3);
    expect(daysUntilExpiry({ ...item, expiresAt: "2026-10-24" }, "2026-10-25")).toBe(-1);
  });

  it("缺货只做同单位比较：无条目记缺，单位不同记不可比", () => {
    const recipe = {
      id: "r1", name: "测试菜谱", source: "personal",
      ingredients: [
        { foodId: "food-tofu", name: "北豆腐", amount: 300, unit: "g" },
        { foodId: "food-egg", name: "鸡蛋", amount: 3, unit: "piece" },
        { foodId: "food-oil", name: "食用油", amount: 10, unit: "g" },
      ],
      nutrition: initialState.recipes[0].nutrition,
      totalMinutes: 10, equipment: [], createdAt: "t", version: 1,
    } as unknown as RecipeVersion;
    const pantry: PantryItem[] = [
      { id: "p1", foodDefinitionId: "food-tofu", quantity: 200, unit: "g", createdAt: "t", updatedAt: "t" }, // 同单位不足 → 缺
      { id: "p2", foodDefinitionId: "food-egg", quantity: 10, unit: "g", createdAt: "t", updatedAt: "t" },   // 单位不同 → 不可比
      // food-oil 无条目 → 缺
    ];
    const shortage = recipeShortage(recipe, pantry);
    expect(shortage.missingCount).toBe(2);
    expect(shortage.missingNames).toEqual(["北豆腐", "食用油"]);
    expect(shortage.incomparableCount).toBe(1);
  });
});

describe("重置语义：食物柜随食材库保留", () => {
  it("buildResetState 保留 pantryItems 并计数", async () => {
    seedFoods();
    await store().pantryAdjust({ foodDefinitionId: "food-tofu", delta: 500, unit: "g" });
    const { state, summary } = buildResetState(store());
    expect(state.pantryItems).toHaveLength(1);
    expect(summary.keptPantryItems).toBe(1);
    expect(summary.clearedMeals).toBe(state.meals.length + 0); // 镜像口径同源
  });
});

describe("食材库页食物柜分组", () => {
  it("opens the entry modal without the React #185 update loop (regression)", async () => {
    seedFoods();
    await act(async () => { root.render(<FoodLibraryPage />); });
    const pantryTab = [...host.querySelectorAll<HTMLButtonElement>(".library-tabs button")].find((tab) => tab.textContent === "食物柜")!;
    await act(async () => pantryTab.click());
    const errors: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => { errors.push(String(args[0])); });
    try {
      const add = [...host.querySelectorAll<HTMLButtonElement>(".pantry-toolbar button")].find((button) => button.textContent?.includes("入库"))!;
      await act(async () => add.click());
      // 弹窗正常打开且没有 Maximum update depth 报错（#185 根因：选择器内 map 返回新数组）。
      expect(host.querySelector(".modal")?.textContent).toContain("入库");
      expect(errors.join("\n")).not.toContain("Maximum update depth");
      // 自绘食材下拉（原生 select 弹层在 WebView 错位，第三轮起弃用）：展开→选择→回填。
      const trigger = host.querySelector<HTMLButtonElement>(".pantry-picker-trigger")!;
      expect(trigger.textContent).toContain("北豆腐");
      await act(async () => trigger.click());
      const options = [...host.querySelectorAll(".pantry-picker-pop button")];
      expect(options.length).toBeGreaterThan(0);
      await act(async () => (options[0] as HTMLButtonElement).click());
      expect(host.querySelector(".pantry-picker-pop")).toBeNull();
      expect(trigger.textContent).toContain("北豆腐");
    } finally {
      spy.mockRestore();
    }
  });

  it("切到食物柜分组显示面板与入库入口，列表带快捷增减", async () => {
    seedFoods();
    await act(async () => { root.render(<FoodLibraryPage />); });
    const tabs = [...host.querySelectorAll(".library-tabs button")] as HTMLButtonElement[];
    expect(tabs.map((tab) => tab.textContent)).toEqual(["全部", "最近使用", "常用收藏", "已归档", "食物柜"]);

    const pantryTab = tabs.find((tab) => tab.textContent === "食物柜")!;
    await act(async () => pantryTab.click());
    expect(host.querySelector(".pantry-panel")).not.toBeNull();
    // 第三轮：搜索栏在食物柜分组保持可见，且按名称/品牌过滤柜内列表。
    const searchInput = host.querySelector<HTMLInputElement>(".library-search input")!;
    expect(searchInput).not.toBeNull();
    expect(searchInput.placeholder).toContain("柜内");
    expect(host.textContent).toContain("食物柜还是空的");

    // 入库一条后列表出现快捷 ±，且低存量高亮。
    await act(async () => {
      await store().pantryAdjust({ foodDefinitionId: "food-tofu", delta: 100, unit: "g", lowStockThreshold: 200 });
    });
    expect(host.querySelector(".pantry-item.low")).not.toBeNull();
    expect(host.querySelector(".pantry-item")?.textContent).toContain("北豆腐");
    const minus = host.querySelector('button[aria-label^="取出"]') as HTMLButtonElement;
    expect(minus).toBeTruthy();
    await act(async () => minus.click());
    expect(store().pantryItems[0].quantity).toBe(50);

    // 搜索过滤：命中显示，未命中显示空态文案。
    const setInput = (value: string) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(searchInput, value);
      searchInput.dispatchEvent(new Event("input", { bubbles: true }));
    };
    await act(async () => setInput("北豆腐"));
    expect(host.querySelector(".pantry-item")).not.toBeNull();
    await act(async () => setInput("不存在的词"));
    expect(host.querySelector(".pantry-item")).toBeNull();
    expect(host.textContent).toContain("没有匹配的柜内食材");
  });
});
