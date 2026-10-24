import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { invoke } from "@tauri-apps/api/core";
import { activeMeals, nutrition } from "../domain/calculations";
import { createPersonalState, initialState } from "../domain/seed";
import { buildResetState, type ResetSummary } from "../domain/resetState";
import type {
  AppState,
  MealEntry,
  MealType,
  WorkoutSession,
  FoodDefinitionInput,
  FoodMealInput,
  FoodMeasurementBasis,
  RecipeMealInput,
  MealCorrectionInput, RecipeInput, MeasurementCondition, BodyMeasurement,
} from "../domain/types";
import { enqueueDomainCommand, executeDomainCommand, type DomainCommandKind } from "../data/domainCommands";
import { appStorage, flushAppStorageWrites, isTauriRuntime, reportStorageFailure, suppressNextAppStorageWrite } from "../data/storage";
import { foodMealEntries, saveFoodInState } from "../domain/foodLibrary";
import { mealCopySource, mealCopySourceOn, mealLabels } from "../domain/meals";
import { diaryToday } from "../domain/diary";
import {
  BODY_FAT_MAX_PERCENT,
  BODY_FAT_MIN_PERCENT,
  WAIST_MAX_CM,
  WAIST_MIN_CM,
  compareMeasurements,
  isActiveMeasurement,
  makeMeasuredAt,
  shanghaiNowParts,
} from "../domain/body";
import {
  isActiveWorkout,
  validateWorkoutDraft,
  workoutDraftPayload,
  WORKOUT_REASON_LIMIT,
  type WorkoutReviseInput,
} from "../domain/workouts";

const uid = () => crypto.randomUUID();

interface WeightPayload {
  [key: string]: unknown;
  weightKg: number;
  date: string;
  measuredAt?: string;
  condition?: MeasurementCondition;
  note?: string;
  waistCm?: number;
  bodyFatPercent?: number;
}

/** 与 Rust body_commands 保持同一套守卫，浏览器预览不能放松。 */
function weightPayload(input: WeightRecordInput): { payload?: WeightPayload; error?: string } {
  const { weightKg, date } = input;
  if (!Number.isFinite(weightKg) || weightKg < 20 || weightKg > 400) {
    return { error: "体重需在 20–400 kg 之间。" };
  }
  if (Math.abs(weightKg * 100 - Math.round(weightKg * 100)) > 1e-6) {
    return { error: "体重最多保留两位小数。" };
  }
  const payload: WeightPayload = { weightKg: Math.round(weightKg * 100) / 100, date };
  if (input.time) payload.measuredAt = makeMeasuredAt(date, input.time);
  if (input.condition) payload.condition = input.condition;
  const note = input.note?.trim();
  if (note) payload.note = note;
  // 围度与体重不同：没量就不写字段，绝不写 0 占位。
  if (input.waistCm !== undefined) {
    if (!Number.isFinite(input.waistCm) || input.waistCm < WAIST_MIN_CM || input.waistCm > WAIST_MAX_CM) {
      return { error: "腰围需在 40–200 cm 之间。" };
    }
    if (Math.abs(input.waistCm * 10 - Math.round(input.waistCm * 10)) > 1e-6) {
      return { error: "腰围最多保留一位小数。" };
    }
    payload.waistCm = Math.round(input.waistCm * 10) / 10;
  }
  if (input.bodyFatPercent !== undefined) {
    if (
      !Number.isFinite(input.bodyFatPercent) ||
      input.bodyFatPercent < BODY_FAT_MIN_PERCENT ||
      input.bodyFatPercent > BODY_FAT_MAX_PERCENT
    ) {
      return { error: "体脂率需在 3%–70% 之间。" };
    }
    if (Math.abs(input.bodyFatPercent * 10 - Math.round(input.bodyFatPercent * 10)) > 1e-6) {
      return { error: "体脂率最多保留一位小数。" };
    }
    payload.bodyFatPercent = Math.round(input.bodyFatPercent * 10) / 10;
  }
  return { payload };
}

function measurementFromPayload(
  id: string,
  payload: WeightPayload,
  now: string,
  extra: Partial<BodyMeasurement>,
): BodyMeasurement {
  return {
    id,
    date: payload.date,
    weightKg: payload.weightKg,
    ...(payload.measuredAt ? { measuredAt: payload.measuredAt } : {}),
    ...(payload.condition ? { condition: payload.condition } : {}),
    ...(payload.note ? { note: payload.note } : {}),
    ...(payload.waistCm !== undefined ? { waistCm: payload.waistCm } : {}),
    ...(payload.bodyFatPercent !== undefined ? { bodyFatPercent: payload.bodyFatPercent } : {}),
    source: "manual",
    status: "active",
    createdAt: now,
    ...extra,
  };
}
const reopenedCheckIns = (state: AppState, date: string) => state.checkIns.map(item => item.date === date && item.complete ? { ...item, complete: false, completedAt: undefined } : item);
export interface ActionResult { error?: string; duplicate?: boolean; isOutlier?: boolean; foodId?: string; foodVersionId?: string; mealIds?: string[]; recipeVersionId?: string; date?: string; draftId?: string; draftRevision?: number }

export interface WeightRecordInput {
  weightKg: number;
  date: string;
  /** 'HH:mm'；留空表示未标注称重时刻。 */
  time?: string;
  condition?: MeasurementCondition;
  note?: string;
  /** 腰围 cm，一位小数；不传＝这次没量，不写字段。 */
  waistCm?: number;
  /** 体脂率 %，一位小数；不传＝这次没量，不写字段。 */
  bodyFatPercent?: number;
}

export interface WeightReviseInput extends WeightRecordInput {
  measurementId: string;
  reason: string;
}

interface AppActions {
  correctMeal: (input: MealCorrectionInput, voided: boolean, commandId?: string) => Promise<ActionResult>;
  saveRecipe: (input: RecipeInput, commandId?: string) => Promise<ActionResult>;
  saveFoodDefinition: (input: FoodDefinitionInput, foodId?: string, expectedVersionId?: string, commandId?: string) => Promise<ActionResult>;
  setFoodFavorite: (foodId: string, favorite: boolean, commandId?: string) => Promise<ActionResult>;
  setFoodArchived: (foodId: string, archived: boolean, commandId?: string) => Promise<ActionResult>;
  deleteFood: (foodId: string, commandId?: string) => Promise<ActionResult>;
  correctFoodIdentity: (input: { foodId: string; name: string; brand?: string; measurementBasis: FoodMeasurementBasis }, commandId?: string) => Promise<ActionResult>;
  recordFoodMeal: (input: FoodMealInput, commandId?: string) => Promise<ActionResult>;
  recordRecipeMeal: (input: RecipeMealInput, commandId?: string) => Promise<ActionResult>;
  addMeal: (input: {
    name: string;
    type: MealType;
    amountLabel: string;
    calories: number;
    protein: number;
    fiber?: number;
    carbohydrates?: number;
    fat?: number;
    sugar?: number;
    sodium?: number;
    date?: string;
  }, commandId?: string) => Promise<ActionResult>;
  copyMeal: (input: { date: string; type: MealType; sourceDate?: string }, commandId?: string) => Promise<ActionResult>;
  addWeight: (weightKg: number, date?: string, commandId?: string) => Promise<ActionResult>;
  recordWeight: (input: WeightRecordInput, commandId?: string) => Promise<ActionResult>;
  reviseWeight: (input: WeightReviseInput, commandId?: string) => Promise<ActionResult>;
  voidWeight: (input: { measurementId: string; reason: string }, commandId?: string) => Promise<ActionResult>;
  setWeightRepresentative: (measurementId: string, commandId?: string) => Promise<ActionResult>;
  addWorkout: (input: Omit<WorkoutSession, "id" | "createdAt">, commandId?: string) => Promise<ActionResult>;
  reviseWorkout: (input: WorkoutReviseInput, commandId?: string) => Promise<ActionResult>;
  voidWorkout: (input: { workoutId: string; reason: string }, commandId?: string) => Promise<ActionResult>;
  undoWorkoutCorrection: (input: { workoutId: string; reason?: string }, commandId?: string) => Promise<ActionResult>;
  restoreVoidedWorkout: (input: { workoutId: string; reason: string }, commandId?: string) => Promise<ActionResult>;
  setCheckIn: (input: { hunger?: number; energy?: number; date?: string }, commandId?: string) => Promise<ActionResult>;
  setDayComplete: (date: string, complete: boolean, commandId?: string) => Promise<ActionResult>;
  toggleDayComplete: (commandId?: string) => Promise<ActionResult>;
  resetDemo: () => Promise<ResetSummary>;
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
      return ({
      ...(isTauriRuntime() ? createPersonalState() : initialState),
      async correctMeal(input, voided, commandId = uid()) {
        if (!isTauriRuntime()) return { error: "餐食纠错需要桌面版，由 Rust 在同一事务中更新日记；浏览器预览不模拟正式写入。" };
        return submit(voided ? "void_meal" : "revise_meal", { ...input }, commandId);
      },
      async saveRecipe(input, commandId = uid()) {
        if (!isTauriRuntime()) return { error: "菜谱保存需要桌面版，由 Rust 校验营养版本与换算。" };
        return submit("save_recipe_version", { ...input }, commandId);
      },
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
      async setFoodArchived(foodId, archived, commandId = uid()) {
        // 归档只翻开关，但写入仍需桌面事务；预览环境明确不支持。
        if (!isTauriRuntime()) return { error: "食材归档需要桌面版写入，浏览器预览不模拟正式保存。" };
        return submit("set_food_archived", { foodId, archived }, commandId);
      },
      async deleteFood(foodId, commandId = uid()) {
        // 永久删除依赖 Rust 同事务引用检查；预览环境不模拟，避免误判安全。
        if (!isTauriRuntime()) return { error: "永久删除需要桌面版在同一事务中完成引用检查，浏览器预览不模拟正式保存。" };
        return submit("delete_food", { foodId }, commandId);
      },
      async correctFoodIdentity(input, commandId = uid()) {
        // 身份纠错依赖 Rust 引用检查与生熟状态守卫；预览环境不模拟。
        if (!isTauriRuntime()) return { error: "食材身份纠错需要桌面版引用检查，浏览器预览不模拟正式保存。" };
        return submit("correct_food_identity", { foodId: input.foodId, input: { name: input.name, brand: input.brand, measurementBasis: input.measurementBasis } }, commandId);
      },
      async recordFoodMeal(input, commandId = uid()) {
        if (isTauriRuntime()) return submit("record_food_meal", { ...input }, commandId);
        try {
          const entries = foodMealEntries(get(), input, commandId);
          set((state) => ({ checkIns: reopenedCheckIns(state, input.date), meals: [...state.meals, ...entries], auditEvents: [...state.auditEvents, { id: `${commandId}:audit`, eventType: "record_food_meal", entityType: "food_library", payload: { commandId, mealIds: entries.map((item) => item.id) }, createdAt: new Date().toISOString() }] }));
          return { mealIds: entries.map((item) => item.id) };
        } catch (cause) { return { error: String(cause) }; }
      },
      async recordRecipeMeal(input, commandId = uid()) {
        // 菜谱入餐依赖 Rust 的版本钉住与菜谱校验，预览环境明确不支持，不模拟写入。
        if (!isTauriRuntime()) return { error: "菜谱入餐需要桌面版：由 Rust 钉住菜谱内的食材版本并校验条目归属；浏览器预览不模拟正式写入。" };
        return submit("record_recipe_meal", { ...input }, commandId);
      },
      async addMeal(input, commandId = uid()) {
        if (isTauriRuntime()) return submit("add_meal", input, commandId);
        const invalid = (value: number | undefined) => value !== undefined && (!Number.isFinite(value) || value < 0);
        const optionalNutrients = [input.fiber, input.carbohydrates, input.fat, input.sugar, input.sodium];
        if (!input.name.trim() || !input.amountLabel.trim() || !Number.isFinite(input.calories) || input.calories < 0 || !Number.isFinite(input.protein) || input.protein < 0 || optionalNutrients.some(invalid)) return { error: "请检查名称、份量和营养值。" };
        const now = new Date();
        const meal: MealEntry = {
          id: uid(),
          date: input.date ?? diaryToday(),
          type: input.type,
          name: input.name,
          amountLabel: input.amountLabel,
          nutrition: nutrition({
            calories: input.calories,
            protein: input.protein,
            fiber: input.fiber,
            carbohydrates: input.carbohydrates,
            fat: input.fat,
            sugar: input.sugar,
            sodium: input.sodium,
          }),
          consumedRatio: 1,
          source: "manual",
          confidence: "high",
          createdAt: now.toISOString(),
        };
        set((state) => ({ checkIns: reopenedCheckIns(state, meal.date), meals: [...state.meals, meal] }));
        return {};
      },
      async copyMeal(input, commandId = uid()) {
        const payload: Record<string, unknown> = { date: input.date, type: input.type };
        if (input.sourceDate) payload.sourceDate = input.sourceDate;
        if (isTauriRuntime()) return submit("copy_meal", payload, commandId);

        // 预览分支与 Rust 同口径：目标餐次必须空着；来源默认取最近一天，
        // 用户显式选了历史日期时按选定日期取（旧实现固定取最近再比对，选历史日期必错）。
        if (input.date > diaryToday()) return { error: "不能照搬到未来的日期。" };
        const state = get();
        const targetHasEntry = activeMeals(state.meals).some(
          (entry) => entry.date === input.date && entry.type === input.type,
        );
        if (targetHasEntry) return { error: `${mealLabels[input.type]}已有记录，先编辑或作废再照搬。` };
        if (input.sourceDate && !/^\d{4}-\d{2}-\d{2}$/.test(input.sourceDate)) return { error: "来源日期必须为有效的 YYYY-MM-DD。" };
        const source = input.sourceDate
          ? mealCopySourceOn(state.meals, input.type, input.sourceDate)
          : mealCopySource(state.meals, input.type, input.date);
        if (!source) return { error: input.sourceDate ? `${input.sourceDate} 没有${mealLabels[input.type]}记录。` : `之前还没有${mealLabels[input.type]}记录，先记一次再照搬。` };

        const now = new Date().toISOString();
        const entryIds: string[] = [];
        const copies = source.entries.map((entry) => {
          const id = uid();
          entryIds.push(id);
          const copy: MealEntry = { ...entry, id, date: input.date, createdAt: now, copiedFromId: entry.id };
          delete copy.status;
          delete copy.supersededBy;
          delete copy.supersedesId;
          delete copy.correctedAt;
          delete copy.correctionReason;
          return copy;
        });
        set((current) => ({
          meals: [...current.meals, ...copies],
          auditEvents: [
            ...current.auditEvents,
            {
              id: `${commandId}:audit`,
              eventType: "meals_copied",
              entityType: "meal",
              entityId: `${input.date}:${input.type}`,
              payload: {
                date: input.date,
                type: input.type,
                sourceDate: source.date,
                count: copies.length,
                entryIds,
              },
              createdAt: now,
            },
          ],
        }));
        return {};
      },
      async addWeight(weightKg, date = diaryToday(), commandId = uid()) {
        const { time } = shanghaiNowParts();
        return get().recordWeight({ weightKg, date, time }, commandId);
      },
      async recordWeight(input, commandId = uid()) {
        const built = weightPayload(input);
        if (built.error || !built.payload) return { error: built.error ?? "体重无效。" };
        if (isTauriRuntime()) return submit("add_weight", built.payload, commandId);
        const now = new Date().toISOString();
        const id = uid();
        const state = get();
        const previous = [...state.measurements]
          .filter(isActiveMeasurement)
          .filter((item) => item.date <= built.payload!.date)
          .sort(compareMeasurements)
          .at(-1);
        const outlier = previous ? Math.abs(previous.weightKg - built.payload.weightKg) > 3 : false;
        const measurement = measurementFromPayload(id, built.payload, now, { isOutlier: outlier });
        set((current) => ({
          measurements: [...current.measurements, measurement].sort(compareMeasurements),
          auditEvents: [
            ...current.auditEvents,
            {
              id: `${commandId}:audit`,
              eventType: "body_measurement_created",
              entityType: "body_measurement",
              entityId: id,
              payload: { ...built.payload, isOutlier: outlier },
              createdAt: now,
            },
          ],
        }));
        return { isOutlier: outlier };
      },
      async reviseWeight(input, commandId = uid()) {
        const built = weightPayload(input);
        if (built.error || !built.payload) return { error: built.error ?? "体重无效。" };
        const reason = input.reason.trim();
        if (!reason) return { error: "请填写修改原因。" };
        if (isTauriRuntime()) {
          return submit("revise_weight", { ...built.payload, measurementId: input.measurementId, reason }, commandId);
        }
        const state = get();
        const target = state.measurements.find((item) => item.id === input.measurementId);
        if (!target) return { error: "找不到这条体重记录。" };
        if (!isActiveMeasurement(target)) return { error: "这条体重已修订或作废，请刷新后操作最新记录。" };
        const now = new Date().toISOString();
        const id = uid();
        const previous = [...state.measurements]
          .filter(isActiveMeasurement)
          .filter((item) => item.id !== target.id && item.date <= built.payload!.date)
          .sort(compareMeasurements)
          .at(-1);
        const outlier = previous ? Math.abs(previous.weightKg - built.payload.weightKg) > 3 : false;
        const measurement = measurementFromPayload(id, built.payload, now, {
          isOutlier: outlier,
          supersedesId: target.id,
          ...(target.dayRepresentative ? { dayRepresentative: true } : {}),
        });
        set((current) => ({
          measurements: [
            ...current.measurements.map((item) =>
              item.id === target.id
                ? {
                    ...item,
                    status: "superseded" as const,
                    supersededBy: id,
                    correctedAt: now,
                    correctionReason: reason,
                    dayRepresentative: false,
                  }
                : item,
            ),
            measurement,
          ].sort(compareMeasurements),
          auditEvents: [
            ...current.auditEvents,
            {
              id: `${commandId}:audit`,
              eventType: "body_measurement_revised",
              entityType: "body_measurement",
              entityId: id,
              payload: { before: target, after: built.payload, reason },
              createdAt: now,
            },
          ],
        }));
        return {};
      },
      async voidWeight(input, commandId = uid()) {
        const reason = input.reason.trim();
        if (!reason) return { error: "请填写修改原因。" };
        if (isTauriRuntime()) {
          return submit("void_weight", { measurementId: input.measurementId, reason }, commandId);
        }
        const state = get();
        const target = state.measurements.find((item) => item.id === input.measurementId);
        if (!target) return { error: "找不到这条体重记录。" };
        if (!isActiveMeasurement(target)) return { error: "这条体重已修订或作废，请刷新后操作最新记录。" };
        const now = new Date().toISOString();
        set((current) => ({
          measurements: current.measurements.map((item) =>
            item.id === target.id
              ? { ...item, status: "void" as const, voidedAt: now, correctionReason: reason, dayRepresentative: false }
              : item,
          ),
          auditEvents: [
            ...current.auditEvents,
            {
              id: `${commandId}:audit`,
              eventType: "body_measurement_voided",
              entityType: "body_measurement",
              entityId: target.id,
              payload: { before: target, reason },
              createdAt: now,
            },
          ],
        }));
        return {};
      },
      async setWeightRepresentative(measurementId, commandId = uid()) {
        if (isTauriRuntime()) return submit("set_weight_representative", { measurementId }, commandId);
        const state = get();
        const target = state.measurements.find((item) => item.id === measurementId);
        if (!target) return { error: "找不到这条体重记录。" };
        if (!isActiveMeasurement(target)) return { error: "这条体重已修订或作废，请刷新后操作最新记录。" };
        const siblings = state.measurements.filter((item) => item.date === target.date && isActiveMeasurement(item));
        const already = siblings.every((item) => (item.id === target.id ? item.dayRepresentative === true : item.dayRepresentative !== true));
        if (already) return {};
        const now = new Date().toISOString();
        const previous = siblings.find((item) => item.dayRepresentative === true)?.id;
        set((current) => ({
          measurements: current.measurements.map((item) => {
            if (item.date !== target.date || !isActiveMeasurement(item)) return item;
            if (item.id === target.id) return { ...item, dayRepresentative: true };
            const { dayRepresentative: _ignored, ...rest } = item;
            return rest;
          }),
          auditEvents: [
            ...current.auditEvents,
            {
              id: `${commandId}:audit`,
              eventType: "body_measurement_representative_changed",
              entityType: "body_measurement",
              entityId: target.id,
              payload: { date: target.date, measurementId: target.id, previousId: previous },
              createdAt: now,
            },
          ],
        }));
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
      async reviseWorkout(input, commandId = uid()) {
        const validation = validateWorkoutDraft(input);
        if (validation.error) return { error: validation.error };
        const reason = input.reason.trim();
        if (!reason) return { error: "请填写修改原因。" };
        if (reason.length > WORKOUT_REASON_LIMIT) return { error: `原因不能超过 ${WORKOUT_REASON_LIMIT} 字。` };
        const draft = workoutDraftPayload(input) as unknown as Omit<WorkoutSession, "id" | "createdAt">;
        if (isTauriRuntime()) {
          return submit("revise_workout", { ...draft, workoutId: input.workoutId, reason }, commandId);
        }
        const state = get();
        const target = state.workouts.find((item) => item.id === input.workoutId);
        if (!target) return { error: "找不到这条运动记录。" };
        if (!isActiveWorkout(target)) return { error: "这条运动已修订或作废，请刷新后操作最新记录。" };
        const now = new Date().toISOString();
        const id = uid();
        set((current) => ({
          workouts: [
            ...current.workouts.map((item) =>
              item.id === target.id
                ? {
                    ...item,
                    status: "superseded" as const,
                    supersededBy: id,
                    correctedAt: now,
                    correctionReason: reason,
                  }
                : item,
            ),
            { ...draft, id, createdAt: now, status: "active" as const, supersedesId: target.id },
          ],
          auditEvents: [
            ...current.auditEvents,
            {
              id: `${commandId}:audit`,
              eventType: "workout_revised",
              entityType: "workout_session",
              entityId: id,
              payload: { before: target, after: draft, reason },
              createdAt: now,
            },
          ],
        }));
        return {};
      },
      async voidWorkout(input, commandId = uid()) {
        const reason = input.reason.trim();
        if (!reason) return { error: "请填写修改原因。" };
        if (reason.length > WORKOUT_REASON_LIMIT) return { error: `原因不能超过 ${WORKOUT_REASON_LIMIT} 字。` };
        if (isTauriRuntime()) return submit("void_workout", { workoutId: input.workoutId, reason }, commandId);
        const state = get();
        const target = state.workouts.find((item) => item.id === input.workoutId);
        if (!target) return { error: "找不到这条运动记录。" };
        if (!isActiveWorkout(target)) return { error: "这条运动已修订或作废，请刷新后操作最新记录。" };
        const now = new Date().toISOString();
        set((current) => ({
          workouts: current.workouts.map((item) =>
            item.id === target.id
              ? { ...item, status: "void" as const, voidedAt: now, correctionReason: reason }
              : item,
          ),
          auditEvents: [
            ...current.auditEvents,
            {
              id: `${commandId}:audit`,
              eventType: "workout_voided",
              entityType: "workout_session",
              entityId: target.id,
              payload: { before: target, reason },
              createdAt: now,
            },
          ],
        }));
        return {};
      },
      async undoWorkoutCorrection(input, commandId = uid()) {
        const reason = (input.reason ?? "").trim();
        if (reason.length > WORKOUT_REASON_LIMIT) return { error: `原因不能超过 ${WORKOUT_REASON_LIMIT} 字。` };
        const payload: Record<string, unknown> = { workoutId: input.workoutId };
        // 撤销的原因可留空：没写就不带这个键，审计里留 null，不伪造用户意图。
        if (reason) payload.reason = reason;
        if (isTauriRuntime()) return submit("undo_workout_correction", payload, commandId);
        const state = get();
        // 只认指针，不看 id 前缀：浏览器预览用 uid()，Rust 用 {kind}-{commandId}。
        const head = state.workouts.find((item) => item.id === input.workoutId);
        if (!head) return { error: "找不到这条运动记录。" };
        if (!isActiveWorkout(head)) return { error: "这条运动记录当前不是有效记录，无法撤销更正。" };
        if (!head.supersedesId) return { error: "这条运动不是更正产生的，没有可撤销的更正。" };
        const parent = state.workouts.find((item) => item.id === head.supersedesId);
        if (!parent) return { error: "找不到被更正的原始记录，无法撤销。" };
        if (parent.status !== "superseded") return { error: "这条更正已经撤销过或已被改动，请刷新后重试。" };
        if (parent.supersededBy !== head.id) return { error: "更正记录之间的关系已不一致，请刷新后重试。" };
        const now = new Date().toISOString();
        const restoredParent: WorkoutSession = {
          ...parent,
          status: "active",
          restoredAt: now,
          restoredCorrectionId: head.id,
          ...(reason ? { restoredReason: reason } : {}),
        };
        // 只清指向已失效对象的指针；correctionReason 留着说明当初为什么改。
        delete restoredParent.supersededBy;
        delete restoredParent.correctedAt;
        const revertedHead: WorkoutSession = {
          ...head,
          status: "reverted",
          revertedAt: now,
          ...(reason ? { revertedReason: reason } : {}),
        };
        set((current) => ({
          workouts: current.workouts.map((item) =>
            item.id === parent.id ? restoredParent : item.id === head.id ? revertedHead : item,
          ),
          auditEvents: [
            ...current.auditEvents,
            {
              id: `${commandId}:audit`,
              eventType: "workout_correction_undone",
              entityType: "workout_session",
              entityId: parent.id,
              payload: {
                before: { head, parent },
                after: { head: revertedHead, parent: restoredParent },
                reason: reason || null,
                restoredWorkoutId: parent.id,
                revertedWorkoutId: head.id,
              },
              createdAt: now,
            },
          ],
        }));
        return {};
      },
      async restoreVoidedWorkout(input, commandId = uid()) {
        const reason = input.reason.trim();
        // 与撤销相反：恢复会让记录重新计入统计，必须写明为什么。
        if (!reason) return { error: "请填写修改原因。" };
        if (reason.length > WORKOUT_REASON_LIMIT) return { error: `原因不能超过 ${WORKOUT_REASON_LIMIT} 字。` };
        if (isTauriRuntime()) return submit("restore_voided_workout", { workoutId: input.workoutId, reason }, commandId);
        const state = get();
        const target = state.workouts.find((item) => item.id === input.workoutId);
        if (!target) return { error: "找不到这条运动记录。" };
        if (target.status !== "void") return { error: "只有已作废的记录可以恢复。" };
        if (target.supersedesId) {
          const parent = state.workouts.find((item) => item.id === target.supersedesId);
          if (!parent || parent.status !== "superseded" || parent.supersededBy !== target.id) {
            return { error: "这条记录与原来的更正链不一致，请刷新后重试。" };
          }
        }
        const now = new Date().toISOString();
        const restored: WorkoutSession = {
          ...target,
          status: "active",
          restoredAt: now,
          restoredReason: reason,
        };
        delete restored.voidedAt;
        set((current) => ({
          workouts: current.workouts.map((item) => (item.id === target.id ? restored : item)),
          auditEvents: [
            ...current.auditEvents,
            {
              id: `${commandId}:audit`,
              eventType: "workout_void_restored",
              entityType: "workout_session",
              entityId: target.id,
              payload: { before: target, after: restored, reason },
              createdAt: now,
            },
          ],
        }));
        return {};
      },
      async setCheckIn(input, commandId = uid()) {
        if (isTauriRuntime()) return submit("set_checkin", input, commandId);
        const date = input.date ?? diaryToday();
        set((state) => ({
          checkIns: state.checkIns.some((item) => item.date === date)
            ? state.checkIns.map((item) => (item.date === date ? { ...item, ...input } : item))
            : [...state.checkIns, { date, complete: false, ...input }],
        }));
        return {};
      },
      async toggleDayComplete(commandId = uid()) {
        const date = diaryToday();
        return get().setDayComplete(date, !get().checkIns.find(item => item.date === date)?.complete, commandId);
      },
      async setDayComplete(date, complete, commandId = uid()) {
        if (isTauriRuntime()) return submit("set_day_complete", { date, complete }, commandId);
        set((state) => {
          const current = state.checkIns.find((item) => item.date === date);
          const next = { date, complete, completedAt: complete ? new Date().toISOString() : undefined };
          return {
            checkIns: current
              ? state.checkIns.map((item) => (item.date === date ? { ...item, ...next } : item))
              : [...state.checkIns, next],
          };
        });
        return {};
      },
      async resetDemo() {
        return enqueueDomainCommand(async () => {
          if (isTauriRuntime()) {
            // 桌面版：Rust 单事务完成保留/清理/实体重建；重置后不得再回写旧状态。
            await flushAppStorageWrites();
            const result = await invoke<{ state: AppState; summary: ResetSummary }>("reset_domain_records");
            suppressNextAppStorageWrite();
            set(result.state);
            return result.summary;
          }
          // 浏览器预览：与 Rust 同一套保留规则，在内存与 localStorage 上镜像执行。
          const { state, summary } = buildResetState(get());
          await appStorage.removeItem("fitwise-app-state-v1");
          set(state);
          await flushAppStorageWrites();
          return summary;
        });
      },
    });
    },
    {
      name: "fitwise-app-state-v1",
      storage: createJSONStorage(() => appStorage),
      version: 4,
      onRehydrateStorage: () => (_state, error) => { if (error) reportStorageFailure(error); },
      migrate(persistedState, version) {
        const persisted = persistedState as Partial<AppState>;
        const base = isTauriRuntime() ? createPersonalState() : initialState;
        return {
          ...base,
          profile: { ...base.profile, ...persisted.profile },
          foodDefinitions: persisted.foodDefinitions ?? [],
          foodDefinitionVersions: persisted.foodDefinitionVersions ?? [],
          meals: persisted.meals ?? [],
          checkIns: persisted.checkIns ?? [],
          measurements: version < 3 ? (persisted.measurements ?? []).map((item) => ({ ...item, status: item.status ?? "active" })) : (persisted.measurements ?? []),
          workouts: persisted.workouts ?? [],
          recipes: persisted.recipes ?? [],
          auditEvents: persisted.auditEvents ?? [],
        } as AppStore;
      },
    },
  ),
);
