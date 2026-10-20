import { format } from "date-fns";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { deductInventoryFEFO, nutrition } from "../domain/calculations";
import { createPersonalState, initialState } from "../domain/seed";
import type {
  AppState,
  AiSettings,
  InboxItem,
  MealEntry,
  MealType,
  PlanCandidate,
  PreparedBatch,
  PurchaseDraft,
  WorkoutSession,
  FoodDefinitionInput,
  FoodMealInput,
  ReceivePurchaseInput, InventoryCountInput, InventoryDisposalInput,
} from "../domain/types";
import { enqueueDomainCommand, executeDomainCommand, type DomainCommandKind } from "../data/domainCommands";
import { appStorage, flushAppStorageWrites, isTauriRuntime, suppressNextAppStorageWrite } from "../data/storage";
import { foodMealEntries, saveFoodInState } from "../domain/foodLibrary";
import { applyInventoryOperation } from "../domain/purchases";

const uid = () => crypto.randomUUID();
export interface ActionResult { error?: string; duplicate?: boolean; isOutlier?: boolean; foodId?: string; foodVersionId?: string; mealIds?: string[] }

interface AppActions {
  saveFoodDefinition: (input: FoodDefinitionInput, foodId?: string, expectedVersionId?: string, commandId?: string) => Promise<ActionResult>;
  setFoodFavorite: (foodId: string, favorite: boolean, commandId?: string) => Promise<ActionResult>;
  recordFoodMeal: (input: FoodMealInput, commandId?: string) => Promise<ActionResult>;
  addMeal: (input: {
    name: string;
    type: MealType;
    amountLabel: string;
    calories: number;
    protein: number;
    fiber?: number;
  }, commandId?: string) => Promise<ActionResult>;
  addWeight: (weightKg: number, date?: string, commandId?: string) => Promise<ActionResult>;
  addWorkout: (input: Omit<WorkoutSession, "id" | "createdAt">, commandId?: string) => Promise<ActionResult>;
  setCheckIn: (input: { hunger?: number; energy?: number }, commandId?: string) => Promise<ActionResult>;
  toggleDayComplete: (commandId?: string) => Promise<ActionResult>;
  addPurchase: (draft: Omit<PurchaseDraft, "id">, commandId?: string) => Promise<ActionResult>;
  revisePurchase: (purchaseId:string,draft:Omit<PurchaseDraft,"id">,commandId?:string)=>Promise<ActionResult>;
  receivePurchaseActual: (input:ReceivePurchaseInput,commandId?:string)=>Promise<ActionResult>;
  closePurchase: (purchaseId:string,reason:string,commandId?:string)=>Promise<ActionResult>;
  recordPurchasePayment: (purchaseId:string,paidCny:number,refundedCny:number,reason:string,commandId?:string)=>Promise<ActionResult>;
  countInventory: (input:InventoryCountInput,commandId?:string)=>Promise<ActionResult>;
  disposeInventory: (input:InventoryDisposalInput,commandId?:string)=>Promise<ActionResult>;
  receivePurchase: (purchaseId: string, commandId?: string) => Promise<{ error?: string }>;
  adjustInventory: (lotId: string, remainingAmount: number, reason: string, commandId?: string) => Promise<{ error?: string }>;
  selectPlan: (planId: string, commandId?: string) => Promise<ActionResult>;
  addInboxItem: (item: Omit<InboxItem, "id" | "receivedAt" | "status">, commandId?: string) => Promise<ActionResult>;
  setInboxStatus: (id: string, status: InboxItem["status"], commandId?: string) => Promise<ActionResult>;
  setAiSettings: (settings: Partial<AiSettings>, commandId?: string) => Promise<ActionResult>;
  recordAiUsage: (estimatedCostCny: number, commandId?: string) => Promise<ActionResult>;
  prepareRecipe: (recipeVersionId: string, commandId?: string) => Promise<{ shortage: string[]; batchId?: string }>;
  consumeBatch: (input: { batchId: string; mealType: MealType; ratio: number; ratioIsEstimated: boolean; commandId?: string }) => Promise<{ error?: string }>;
  discardBatchRemainder: (batchId: string, reason?: "discarded" | "spoiled" | "other", commandId?: string) => Promise<{ error?: string }>;
  resetDemo: () => Promise<void>;
}

export type AppStore = AppState & AppActions;

export const useAppStore = create<AppStore>()(
  persist(
    (set, get) => {
      const commit = <TResult,>(kind: DomainCommandKind, payload: Record<string, unknown>, commandId: string) =>
        enqueueDomainCommand(async () => {
          const response = await executeDomainCommand<TResult>(get(), commandId, kind, payload);
          suppressNextAppStorageWrite();
          set(response.state);
          return response;
        });
      const submit = async (kind: DomainCommandKind, payload: Record<string, unknown>, commandId: string): Promise<ActionResult> => {
        try { return (await commit<ActionResult>(kind, payload, commandId)).result; }
        catch (cause) { return { error: cause instanceof Error ? cause.message : String(cause) }; }
      };
      const inventoryCommand = async (kind:DomainCommandKind,payload:Record<string,unknown>,commandId:string):Promise<ActionResult>=>{
        if(isTauriRuntime())return submit(kind,payload,commandId);
        try{set(applyInventoryOperation(get(),kind,payload,commandId));return {};}catch(cause){return {error:cause instanceof Error?cause.message:String(cause)};}
      };
      return ({
      ...(isTauriRuntime() ? createPersonalState() : initialState),
      async saveFoodDefinition(input, foodId, expectedVersionId, commandId = uid()) {
        if (isTauriRuntime()) return submit(foodId ? "revise_food_definition" : "save_food_definition", { input, ...(foodId ? { foodId, expectedVersionId } : {}) }, commandId);
        try { const saved = saveFoodInState(get(), input, commandId, foodId, expectedVersionId); set(saved.state); return saved.result; }
        catch (cause) { return { error: String(cause) }; }
      },
      async setFoodFavorite(foodId, favorite, commandId = uid()) {
        if (isTauriRuntime()) return submit("set_food_favorite", { foodId, favorite }, commandId);
        if (!get().foodDefinitions.some((item) => item.id === foodId)) return { error: "找不到食物。" };
        set((state) => ({ foodDefinitions: state.foodDefinitions.map((item) => item.id === foodId ? { ...item, favorite } : item) }));
        return {};
      },
      async recordFoodMeal(input, commandId = uid()) {
        if (isTauriRuntime()) return submit("record_food_meal", { ...input }, commandId);
        try {
          const entries = foodMealEntries(get(), input, commandId);
          set((state) => ({ meals: [...state.meals, ...entries], auditEvents: [...state.auditEvents, { id: `${commandId}:audit`, eventType: "record_food_meal", entityType: "food_library", payload: { commandId, mealIds: entries.map((item) => item.id) }, createdAt: new Date().toISOString() }] }));
          return { mealIds: entries.map((item) => item.id) };
        } catch (cause) { return { error: String(cause) }; }
      },
      async addMeal(input, commandId = uid()) {
        if (isTauriRuntime()) return submit("add_meal", input, commandId);
        if (!input.name.trim() || !input.amountLabel.trim() || !Number.isFinite(input.calories) || input.calories < 0 || !Number.isFinite(input.protein) || input.protein < 0 || (input.fiber !== undefined && (!Number.isFinite(input.fiber) || input.fiber < 0))) return { error: "请检查名称、份量和营养值。" };
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
        return {};
      },
      async addWeight(weightKg, date = format(new Date(), "yyyy-MM-dd"), commandId = uid()) {
        if (isTauriRuntime()) return submit("add_weight", { weightKg, date }, commandId);
        if (!Number.isFinite(weightKg) || weightKg <= 0) return { error: "体重必须大于 0。" };
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
        return {};
      },
      async addWorkout(input, commandId = uid()) {
        if (isTauriRuntime()) return submit("add_workout", input, commandId);
        if (!input.name.trim() || !Number.isFinite(input.durationMinutes) || input.durationMinutes <= 0) return { error: "请检查运动名称和时长。" };
        if (input.sourceFingerprint && get().workouts.some((item) => item.sourceFingerprint === input.sourceFingerprint)) return { duplicate: true };
        set((state) => ({
          workouts: [...state.workouts, { ...input, id: uid(), createdAt: new Date().toISOString() }],
        }));
        return {};
      },
      async setCheckIn(input, commandId = uid()) {
        if (isTauriRuntime()) return submit("set_checkin", input, commandId);
        const date = format(new Date(), "yyyy-MM-dd");
        set((state) => ({
          checkIns: state.checkIns.some((item) => item.date === date)
            ? state.checkIns.map((item) => (item.date === date ? { ...item, ...input } : item))
            : [...state.checkIns, { date, complete: false, ...input }],
        }));
        return {};
      },
      async toggleDayComplete(commandId = uid()) {
        if (isTauriRuntime()) {
          const date = format(new Date(), "yyyy-MM-dd");
          return submit("set_day_complete", { date, complete: !get().checkIns.find((item) => item.date === date)?.complete }, commandId);
        }
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
        return {};
      },
      async addPurchase(draft, commandId = uid()) {
        return inventoryCommand("add_purchase",{...draft},commandId);
      },
      async revisePurchase(purchaseId,draft,commandId=uid()){return inventoryCommand("revise_purchase",{...draft,purchaseId},commandId);},
      async receivePurchaseActual(input,commandId=uid()){return inventoryCommand("receive_purchase",{...input},commandId);},
      async closePurchase(purchaseId,reason,commandId=uid()){return inventoryCommand("close_purchase",{purchaseId,reason},commandId);},
      async recordPurchasePayment(purchaseId,paidCny,refundedCny,reason,commandId=uid()){return inventoryCommand("update_purchase_payment",{purchaseId,paidCny,refundedCny,reason},commandId);},
      async countInventory(input,commandId=uid()){return inventoryCommand("adjust_inventory",{...input},commandId);},
      async disposeInventory(input,commandId=uid()){return inventoryCommand("dispose_inventory",{...input},commandId);},
      async receivePurchase(purchaseId, commandId = uid()) {
        return inventoryCommand("receive_purchase",{purchaseId},commandId);
      },
      async adjustInventory(lotId, remainingAmount, reason, commandId = uid()) {
        return inventoryCommand("adjust_inventory",{lotId,remainingAmount,reason},commandId);
      },
      async selectPlan(planId, commandId = uid()) {
        if (isTauriRuntime()) return submit("select_plan", { planId }, commandId);
        const plan = get().plans.find((item) => item.id === planId);
        if (!plan || !plan.recipeVersionId || plan.inventoryCoverage < 100 || plan.missingIngredients.length) return { error: "候选需要完整菜谱与实际库存校验后才能确认。" };
        const recipe = get().recipes.find((item) => item.id === plan.recipeVersionId);
        if (!recipe || recipe.ingredients.some((ingredient) => get().inventory.filter((lot) => lot.foodId === ingredient.foodId && lot.unit === ingredient.unit && (!lot.expiresAt || lot.expiresAt >= format(new Date(), "yyyy-MM-dd"))).reduce((sum, lot) => sum + lot.remainingAmount, 0) < ingredient.amount)) return { error: "当前库存不足或已过期，请实际收货后重新校验。" };
        set((state) => ({
          plans: state.plans.map((plan): PlanCandidate => ({
            ...plan,
            status: plan.id === planId ? "selected" : plan.status === "selected" ? "candidate" : plan.status,
          })),
        }));
        return {};
      },
      async addInboxItem(item, commandId = uid()) {
        if (isTauriRuntime()) return submit("add_inbox_item", item, commandId);
        if (item.fingerprint && get().inbox.some((entry) => entry.fingerprint === item.fingerprint)) return { duplicate: true };
        set((state) => ({
          inbox: [...state.inbox, { ...item, id: uid(), receivedAt: new Date().toISOString(), status: "unreviewed" }],
        }));
        return {};
      },
      async setInboxStatus(id, status, commandId = uid()) {
        if (isTauriRuntime()) return submit("set_inbox_status", { id, status }, commandId);
        set((state) => ({ inbox: state.inbox.map((item) => (item.id === id ? { ...item, status } : item)) }));
        return {};
      },
      async setAiSettings(settings, commandId = uid()) {
        if (isTauriRuntime()) return submit("set_ai_settings", { ...settings, ...(Object.prototype.hasOwnProperty.call(settings, "monthlyLimitCny") ? { monthlyLimitCny: settings.monthlyLimitCny ?? null } : {}) }, commandId);
        set((state) => ({ aiSettings: { ...state.aiSettings, ...settings } }));
        return {};
      },
      async recordAiUsage(estimatedCostCny, commandId = uid()) {
        if (isTauriRuntime()) return submit("record_ai_usage", { estimatedCostCny }, commandId);
        if (!Number.isFinite(estimatedCostCny) || estimatedCostCny < 0) return { error: "费用不能小于 0。" };
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
        return {};
      },
      async prepareRecipe(recipeVersionId, commandId = uid()) {
        if (isTauriRuntime()) {
          try {
            const response = await commit<{ shortage: string[]; batchId?: string }>(
              "prepare_recipe",
              { recipeVersionId },
              commandId,
            );
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
            await commit<Record<string, never>>(
              "consume_batch",
              { batchId, mealType, ratio, ratioIsEstimated },
              commandId,
            );
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
            await commit<Record<string, never>>(
              "discard_batch",
              { batchId, reason },
              commandId,
            );
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
        await enqueueDomainCommand(async () => {
          await flushAppStorageWrites();
          await appStorage.removeItem("fitwise-app-state-v1");
          set(isTauriRuntime() ? createPersonalState() : structuredClone(initialState));
          await flushAppStorageWrites();
        });
      },
    });
    },
    {
      name: "fitwise-app-state-v1",
      storage: createJSONStorage(() => appStorage),
      version: 4,
      migrate(persistedState, version) {
        const persisted = persistedState as Partial<AppState>;
        type LegacyBatch = Omit<PreparedBatch, "remainingRatio" | "status"> & Partial<Pick<PreparedBatch, "remainingRatio" | "status">>;
        const migratedBatches = ((persisted.batches ?? []) as LegacyBatch[]).map((batch) => {
          const remainingRatio = batch.remainingRatio
            ?? Math.max(0, 1 - (batch.consumedRatio ?? 0) - (batch.wastedRatio ?? 0));
          return { ...batch, remainingRatio, status: remainingRatio > 0 ? "open" as const : "closed" as const };
        });
        return {
          ...(isTauriRuntime() ? createPersonalState() : initialState),
          ...persisted,
          foodDefinitions: persisted.foodDefinitions ?? [],
          foodDefinitionVersions: persisted.foodDefinitionVersions ?? [],
          batches: version < 3 ? migratedBatches : (persisted.batches ?? []),
          consumptionEvents: persisted.consumptionEvents ?? [],
          wasteEvents: persisted.wasteEvents ?? [],
          auditEvents: persisted.auditEvents ?? [],
          measurements: version < 3 ? (persisted.measurements ?? []).map((item) => ({ ...item, status: item.status ?? "active" })) : (persisted.measurements ?? []),
          aiSettings: { ...initialState.aiSettings, ...persisted.aiSettings },
        } as AppStore;
      },
    },
  ),
);
