import { format } from "date-fns";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { deductInventoryFEFO, nutrition } from "../domain/calculations";
import { initialState } from "../domain/seed";
import type {
  AppState,
  AiSettings,
  InboxItem,
  InventoryLot,
  MealEntry,
  MealType,
  PlanCandidate,
  PreparedBatch,
  PurchaseDraft,
  WorkoutSession,
} from "../domain/types";
import { executeDomainCommand } from "../data/domainCommands";
import { appStorage, isTauriRuntime, suppressNextAppStorageWrite } from "../data/storage";

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
  receivePurchase: (purchaseId: string, commandId?: string) => Promise<{ error?: string }>;
  adjustInventory: (lotId: string, remainingAmount: number, reason: string, commandId?: string) => Promise<{ error?: string }>;
  selectPlan: (planId: string) => void;
  addInboxItem: (item: Omit<InboxItem, "id" | "receivedAt" | "status">) => void;
  setInboxStatus: (id: string, status: InboxItem["status"]) => void;
  setAiSettings: (settings: Partial<AiSettings>) => void;
  recordAiUsage: (estimatedCostCny: number) => void;
  prepareRecipe: (recipeVersionId: string, commandId?: string) => Promise<{ shortage: string[]; batchId?: string }>;
  consumeBatch: (input: { batchId: string; mealType: MealType; ratio: number; ratioIsEstimated: boolean; commandId?: string }) => Promise<{ error?: string }>;
  discardBatchRemainder: (batchId: string, reason?: "discarded" | "spoiled" | "other", commandId?: string) => Promise<{ error?: string }>;
  resetDemo: () => Promise<void>;
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
        const now = new Date().toISOString();
        const id = uid();
        set((state) => {
          const previous = [...state.measurements]
            .reverse()
            .find((item) => item.date === date && item.status !== "superseded");
          return {
            measurements: [
              ...state.measurements.map((item) => item.id === previous?.id ? { ...item, status: "superseded" as const } : item),
              { id, date, weightKg, status: "active" as const, supersedesId: previous?.id, createdAt: now },
            ].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt)),
            auditEvents: [
              ...state.auditEvents,
              {
                id: uid(),
                eventType: previous ? "body_measurement_superseded" : "body_measurement_created",
                entityType: "body_measurement",
                entityId: id,
                payload: { date, weightKg, supersedesId: previous?.id },
                createdAt: now,
              },
            ],
          };
        });
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
      async receivePurchase(purchaseId, commandId = uid()) {
        if (isTauriRuntime()) {
          try {
            const response = await executeDomainCommand<{ lotId: string }>(
              get(),
              commandId,
              "receive_purchase",
              { purchaseId },
            );
            suppressNextAppStorageWrite();
            set(response.state);
            return {};
          } catch (cause) {
            return { error: cause instanceof Error ? cause.message : String(cause) };
          }
        }
        const purchase = get().purchases.find((item) => item.id === purchaseId);
        if (!purchase || purchase.status === "received") return { error: "这笔采购已经收货或不存在。" };
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
        return {};
      },
      async adjustInventory(lotId, remainingAmount, reason, commandId = uid()) {
        if (isTauriRuntime()) {
          try {
            const response = await executeDomainCommand<Record<string, never>>(
              get(),
              commandId,
              "adjust_inventory",
              { lotId, remainingAmount, reason },
            );
            suppressNextAppStorageWrite();
            set(response.state);
            return {};
          } catch (cause) {
            return { error: cause instanceof Error ? cause.message : String(cause) };
          }
        }
        const current = get().inventory.find((item) => item.id === lotId);
        if (!current || remainingAmount < 0) return { error: "库存批次不存在或数量无效。" };
        const delta = remainingAmount - current.remainingAmount;
        set((state) => ({
          inventory: state.inventory.map((item) => (item.id === lotId ? { ...item, remainingAmount } : item)),
          inventoryMovements: [
            ...state.inventoryMovements,
            { id: uid(), lotId, type: "adjustment", amount: delta, reason, createdAt: new Date().toISOString() },
          ],
        }));
        return {};
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
      setAiSettings(settings) {
        set((state) => ({ aiSettings: { ...state.aiSettings, ...settings } }));
      },
      recordAiUsage(estimatedCostCny) {
        if (!Number.isFinite(estimatedCostCny) || estimatedCostCny < 0) return;
        const usageMonth = format(new Date(), "yyyy-MM");
        set((state) => ({
          aiSettings: {
            ...state.aiSettings,
            usageMonth,
            estimatedSpendCny:
              state.aiSettings.usageMonth === usageMonth
                ? state.aiSettings.estimatedSpendCny + estimatedCostCny
                : estimatedCostCny,
          },
        }));
      },
      async prepareRecipe(recipeVersionId, commandId = uid()) {
        if (isTauriRuntime()) {
          try {
            const response = await executeDomainCommand<{ shortage: string[]; batchId?: string }>(
              get(),
              commandId,
              "prepare_recipe",
              { recipeVersionId },
            );
            if (response.applied) {
              suppressNextAppStorageWrite();
              set(response.state);
            }
            return response.result;
          } catch (cause) {
            return { shortage: [cause instanceof Error ? cause.message : String(cause)] };
          }
        }
        const recipe = get().recipes.find((item) => item.id === recipeVersionId);
        if (!recipe) return { shortage: ["找不到菜谱"] };
        let inventory = get().inventory;
        const movements = [...get().inventoryMovements];
        const shortages: string[] = [];
        for (const ingredient of recipe.ingredients) {
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
        const createdAt = new Date().toISOString();
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
              consumedRatio: 0,
              wastedRatio: 0,
              remainingRatio: 1,
              status: "open",
              ratioIsEstimated: false,
              createdAt,
            },
          ],
          auditEvents: [...state.auditEvents, { id: uid(), eventType: "prepared_batch_created", entityType: "prepared_batch", entityId: batchId, payload: { recipeVersionId }, createdAt }],
        }));
        return { shortage: [], batchId };
      },
      async consumeBatch({ batchId, mealType, ratio, ratioIsEstimated, commandId = uid() }) {
        if (isTauriRuntime()) {
          try {
            const response = await executeDomainCommand<Record<string, never>>(
              get(),
              commandId,
              "consume_batch",
              { batchId, mealType, ratio, ratioIsEstimated },
            );
            if (response.applied) {
              suppressNextAppStorageWrite();
              set(response.state);
            }
            return {};
          } catch (cause) {
            return { error: cause instanceof Error ? cause.message : String(cause) };
          }
        }
        const batch = get().batches.find((item) => item.id === batchId);
        if (!batch || batch.status === "closed") return { error: "这个批次已经结束或不存在。" };
        if (!Number.isFinite(ratio) || ratio <= 0) return { error: "进食比例必须大于 0。" };
        const remaining = batch.remainingRatio ?? Math.max(0, 1 - batch.consumedRatio - batch.wastedRatio);
        if (ratio > remaining + 0.0001) return { error: `最多只能记录剩余整锅的 ${Math.round(remaining * 100)}%。` };
        const recipe = get().recipes.find((item) => item.id === batch.recipeVersionId);
        if (!recipe) return { error: "找不到这个批次对应的菜谱版本。" };
        const eventId = uid();
        const mealId = uid();
        const now = new Date().toISOString();
        const date = format(new Date(), "yyyy-MM-dd");
        const nextRemaining = Math.max(0, Number((remaining - ratio).toFixed(4)));
        set((state) => ({
          batches: state.batches.map((item) => item.id === batchId ? {
            ...item,
            consumedRatio: Number((item.consumedRatio + ratio).toFixed(4)),
            remainingRatio: nextRemaining,
            status: nextRemaining === 0 ? "closed" : "open",
            ratioIsEstimated: item.ratioIsEstimated || ratioIsEstimated,
            closedAt: nextRemaining === 0 ? now : item.closedAt,
          } : item),
          consumptionEvents: [...state.consumptionEvents, { id: eventId, batchId, date, mealType, ratio, ratioIsEstimated, createdAt: now }],
          meals: [...state.meals, {
            id: mealId,
            date,
            type: mealType,
            name: recipe.name,
            amountLabel: `整锅的 ${Math.round(ratio * 100)}%${ratioIsEstimated ? "（估算）" : ""}`,
            nutrition: recipe.nutrition,
            consumedRatio: ratio,
            source: recipe.source,
            confidence: ratioIsEstimated ? "medium" : "high",
            preparedBatchId: batchId,
            consumptionEventId: eventId,
            createdAt: now,
          }],
          auditEvents: [...state.auditEvents, { id: uid(), eventType: "batch_consumption_recorded", entityType: "consumption_event", entityId: eventId, payload: { batchId, mealId, mealType, ratio, ratioIsEstimated }, createdAt: now }],
        }));
        return {};
      },
      async discardBatchRemainder(batchId, reason = "discarded", commandId = uid()) {
        if (isTauriRuntime()) {
          try {
            const response = await executeDomainCommand<Record<string, never>>(
              get(),
              commandId,
              "discard_batch",
              { batchId, reason },
            );
            if (response.applied) {
              suppressNextAppStorageWrite();
              set(response.state);
            }
            return {};
          } catch (cause) {
            return { error: cause instanceof Error ? cause.message : String(cause) };
          }
        }
        const batch = get().batches.find((item) => item.id === batchId);
        if (!batch || batch.status === "closed") return { error: "这个批次已经结束或不存在。" };
        const ratio = batch.remainingRatio ?? Math.max(0, 1 - batch.consumedRatio - batch.wastedRatio);
        if (ratio <= 0) return { error: "这个批次已经没有剩余。" };
        const id = uid();
        const now = new Date().toISOString();
        const date = format(new Date(), "yyyy-MM-dd");
        set((state) => ({
          batches: state.batches.map((item) => item.id === batchId ? { ...item, wastedRatio: Number((item.wastedRatio + ratio).toFixed(4)), remainingRatio: 0, status: "closed", closedAt: now } : item),
          wasteEvents: [...state.wasteEvents, { id, batchId, date, ratio, reason, createdAt: now }],
          auditEvents: [...state.auditEvents, { id: uid(), eventType: "batch_remainder_discarded", entityType: "waste_event", entityId: id, payload: { batchId, ratio, reason }, createdAt: now }],
        }));
        return {};
      },
      async resetDemo() {
        await appStorage.removeItem("fitwise-app-state-v1");
        set(initialState);
      },
    }),
    {
      name: "fitwise-app-state-v1",
      storage: createJSONStorage(() => appStorage),
      version: 3,
      migrate(persistedState) {
        const persisted = persistedState as Partial<AppState>;
        type LegacyBatch = Omit<PreparedBatch, "remainingRatio" | "status"> & Partial<Pick<PreparedBatch, "remainingRatio" | "status">>;
        const migratedBatches = ((persisted.batches ?? []) as LegacyBatch[]).map((batch) => {
          const remainingRatio = batch.remainingRatio
            ?? Math.max(0, 1 - (batch.consumedRatio ?? 0) - (batch.wastedRatio ?? 0));
          return { ...batch, remainingRatio, status: remainingRatio > 0 ? "open" as const : "closed" as const };
        });
        return {
          ...initialState,
          ...persisted,
          batches: migratedBatches,
          consumptionEvents: persisted.consumptionEvents ?? [],
          wasteEvents: persisted.wasteEvents ?? [],
          auditEvents: persisted.auditEvents ?? [],
          measurements: (persisted.measurements ?? initialState.measurements).map((item) => ({ ...item, status: item.status ?? "active" })),
          aiSettings: { ...initialState.aiSettings, ...persisted.aiSettings },
        } as AppStore;
      },
    },
  ),
);
