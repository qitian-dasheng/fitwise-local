import { format } from "date-fns";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { deductInventoryFEFO, nutrition } from "../domain/calculations";
import { initialState } from "../domain/seed";
import type {
  AppState,
  InboxItem,
  InventoryLot,
  MealEntry,
  MealType,
  PlanCandidate,
  PurchaseDraft,
  WorkoutSession,
} from "../domain/types";
import { appStorage } from "../data/storage";

const uid = () => crypto.randomUUID();

interface AppActions {
  addMeal: (input: {
    name: string;
    type: MealType;
    amountLabel: string;
    calories: number;
    protein: number;
    fiber?: number;
  }) => void;
  addWeight: (weightKg: number, date?: string) => void;
  addWorkout: (input: Omit<WorkoutSession, "id" | "createdAt">) => void;
  setCheckIn: (input: { hunger?: number; energy?: number }) => void;
  toggleDayComplete: () => void;
  addPurchase: (draft: Omit<PurchaseDraft, "id">) => void;
  receivePurchase: (purchaseId: string) => void;
  adjustInventory: (lotId: string, remainingAmount: number, reason: string) => void;
  selectPlan: (planId: string) => void;
  addInboxItem: (item: Omit<InboxItem, "id" | "receivedAt" | "status">) => void;
  setInboxStatus: (id: string, status: InboxItem["status"]) => void;
  cookRecipe: (recipeVersionId: string, consumedRatio: number) => { shortage: string[] };
  resetDemo: () => void;
}

export type AppStore = AppState & AppActions;

export const useAppStore = create<AppStore>()(
  persist(
    (set, get) => ({
      ...initialState,
      addMeal(input) {
        const now = new Date();
        const meal: MealEntry = {
          id: uid(),
          date: format(now, "yyyy-MM-dd"),
          type: input.type,
          name: input.name,
          amountLabel: input.amountLabel,
          nutrition: nutrition({
            calories: input.calories,
            protein: input.protein,
            fiber: input.fiber,
          }),
          consumedRatio: 1,
          source: "manual",
          confidence: "high",
          createdAt: now.toISOString(),
        };
        set((state) => ({ meals: [...state.meals, meal] }));
      },
      addWeight(weightKg, date = format(new Date(), "yyyy-MM-dd")) {
        set((state) => ({
          measurements: [
            ...state.measurements.filter((item) => item.date !== date),
            { id: uid(), date, weightKg, createdAt: new Date().toISOString() },
          ].sort((a, b) => a.date.localeCompare(b.date)),
        }));
      },
      addWorkout(input) {
        if (input.sourceFingerprint && get().workouts.some((item) => item.sourceFingerprint === input.sourceFingerprint)) return;
        set((state) => ({
          workouts: [...state.workouts, { ...input, id: uid(), createdAt: new Date().toISOString() }],
        }));
      },
      setCheckIn(input) {
        const date = format(new Date(), "yyyy-MM-dd");
        set((state) => ({
          checkIns: state.checkIns.some((item) => item.date === date)
            ? state.checkIns.map((item) => (item.date === date ? { ...item, ...input } : item))
            : [...state.checkIns, { date, complete: false, ...input }],
        }));
      },
      toggleDayComplete() {
        const date = format(new Date(), "yyyy-MM-dd");
        set((state) => {
          const current = state.checkIns.find((item) => item.date === date);
          const complete = !current?.complete;
          const next = { date, complete, completedAt: complete ? new Date().toISOString() : undefined };
          return {
            checkIns: current
              ? state.checkIns.map((item) => (item.date === date ? { ...item, ...next } : item))
              : [...state.checkIns, next],
          };
        });
      },
      addPurchase(draft) {
        set((state) => ({ purchases: [...state.purchases, { ...draft, id: uid() }] }));
      },
      receivePurchase(purchaseId) {
        const purchase = get().purchases.find((item) => item.id === purchaseId);
        if (!purchase || purchase.status === "received") return;
        const lot: InventoryLot = {
          id: uid(),
          foodId: `food-${purchase.name.trim().toLowerCase().replace(/\s+/g, "-")}`,
          name: purchase.name,
          purchasedAmount: purchase.amount,
          remainingAmount: purchase.amount,
          unit: purchase.unit,
          purchasePriceCny: purchase.priceCny,
          purchasedAt: format(new Date(), "yyyy-MM-dd"),
          receivedAt: format(new Date(), "yyyy-MM-dd"),
          opened: false,
          confidence: purchase.confidence,
          source: purchase.platform,
        };
        set((state) => ({
          purchases: state.purchases.map((item) => (item.id === purchaseId ? { ...item, status: "received" } : item)),
          inventory: [...state.inventory, lot],
          inventoryMovements: [
            ...state.inventoryMovements,
            { id: uid(), lotId: lot.id, type: "purchase", amount: lot.purchasedAmount, reason: "确认收货", createdAt: new Date().toISOString() },
          ],
        }));
      },
      adjustInventory(lotId, remainingAmount, reason) {
        const current = get().inventory.find((item) => item.id === lotId);
        if (!current || remainingAmount < 0) return;
        const delta = remainingAmount - current.remainingAmount;
        set((state) => ({
          inventory: state.inventory.map((item) => (item.id === lotId ? { ...item, remainingAmount } : item)),
          inventoryMovements: [
            ...state.inventoryMovements,
            { id: uid(), lotId, type: "adjustment", amount: delta, reason, createdAt: new Date().toISOString() },
          ],
        }));
      },
      selectPlan(planId) {
        set((state) => ({
          plans: state.plans.map((plan): PlanCandidate => ({
            ...plan,
            status: plan.id === planId ? "selected" : plan.status === "selected" ? "candidate" : plan.status,
          })),
        }));
      },
      addInboxItem(item) {
        set((state) => ({
          inbox: [...state.inbox, { ...item, id: uid(), receivedAt: new Date().toISOString(), status: "unreviewed" }],
        }));
      },
      setInboxStatus(id, status) {
        set((state) => ({ inbox: state.inbox.map((item) => (item.id === id ? { ...item, status } : item)) }));
      },
      cookRecipe(recipeVersionId, consumedRatio) {
        const recipe = get().recipes.find((item) => item.id === recipeVersionId);
        if (!recipe) return { shortage: ["找不到菜谱"] };
        let inventory = get().inventory;
        const movements = [...get().inventoryMovements];
        const shortages: string[] = [];
        for (const ingredient of recipe.ingredients) {
          if (ingredient.unit === "piece") continue;
          const result = deductInventoryFEFO(inventory, ingredient.foodId, ingredient.amount);
          inventory = result.lots;
          if (result.shortage > 0) shortages.push(`${ingredient.name} 缺 ${result.shortage}${ingredient.unit}`);
          for (const deduction of result.deductions) {
            movements.push({
              id: uid(),
              lotId: deduction.lotId,
              type: "cooking",
              amount: -deduction.amount,
              reason: recipe.name,
              createdAt: new Date().toISOString(),
            });
          }
        }
        if (shortages.length) return { shortage: shortages };
        const batchId = uid();
        const date = format(new Date(), "yyyy-MM-dd");
        const batchMeal: MealEntry = {
          id: uid(),
          date,
          type: "dinner",
          name: `${recipe.name}（午晚餐共享）`,
          amountLabel: `整锅已食用 ${Math.round(consumedRatio * 100)}%`,
          nutrition: recipe.nutrition,
          consumedRatio,
          source: recipe.source,
          confidence: "medium",
          preparedBatchId: batchId,
          createdAt: new Date().toISOString(),
        };
        set((state) => ({
          inventory,
          inventoryMovements: movements,
          batches: [
            ...state.batches,
            {
              id: batchId,
              recipeVersionId,
              date,
              inventoryDeducted: true,
              consumedRatio,
              wastedRatio: 1 - consumedRatio,
              ratioIsEstimated: consumedRatio !== 1,
              createdAt: new Date().toISOString(),
            },
          ],
          meals: [...state.meals, batchMeal],
        }));
        return { shortage: [] };
      },
      resetDemo() {
        set(initialState);
      },
    }),
    {
      name: "fitwise-app-state-v1",
      storage: createJSONStorage(() => appStorage),
      version: 1,
    },
  ),
);
