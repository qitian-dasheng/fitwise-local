import { create } from "zustand";
import type { FoodLibraryItem, FoodUnit, NutritionFacts } from "../domain/types";

/**
 * 记餐选择器的跨页状态：待确认篮子 + 建档/修订意图 + 回程票。
 * 刻意不做持久化——篮子是未确认草稿，重启清空与原弹窗行为一致；
 * 饮食页 → 食材库页 → 饮食页 的往返靠这里保住篮子不丢。
 */
export interface BasketEntry {
  foodVersionId: string;
  quantity: number;
  unit: FoodUnit;
  name: string;
  facts: NutritionFacts;
}

interface FoodPickerState {
  basket: BasketEntry[];
  setBasket: (updater: (items: BasketEntry[]) => BasketEntry[]) => void;
  clearBasket: () => void;
  /** 饮食页 → 食材库页要打开的编辑器目标；食材库页挂载时消费。 */
  editorTarget: "new" | FoodLibraryItem | null;
  setEditorTarget: (target: "new" | FoodLibraryItem | null) => void;
  /** 建档完成后要回记餐的回程票（食材 id）；饮食页挂载时消费并自动打开选择器。 */
  returnTicket: string | null;
  setReturnTicket: (foodId: string | null) => void;
}

export const useFoodPicker = create<FoodPickerState>((set) => ({
  basket: [],
  setBasket: (updater) => set((state) => ({ basket: updater(state.basket) })),
  clearBasket: () => set({ basket: [] }),
  editorTarget: null,
  setEditorTarget: (target) => set({ editorTarget: target }),
  returnTicket: null,
  setReturnTicket: (foodId) => set({ returnTicket: foodId }),
}));
