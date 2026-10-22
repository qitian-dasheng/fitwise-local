/** 运动记录的有效性判定与输入校验，口径与 Rust `workout_commands` 保持一致。 */

import type { WorkoutSession } from "./types";

export const WORKOUT_NAME_LIMIT = 80;
export const WORKOUT_TYPE_LIMIT = 40;
export const WORKOUT_REASON_LIMIT = 200;
export const WORKOUT_DURATION_MIN = 1;
export const WORKOUT_DURATION_MAX = 1440;
export const WORKOUT_CALORIES_MAX = 5000;
export const WORKOUT_HEART_MIN = 30;
export const WORKOUT_HEART_MAX = 250;

/** 有效记录白名单：缺失 status 或显式 active。禁止写成「不等于 superseded」。 */
export function isActiveWorkout(workout: WorkoutSession) {
  return !workout.status || workout.status === "active";
}

export function activeWorkouts(list: WorkoutSession[]) {
  return list.filter(isActiveWorkout);
}

export interface WorkoutDraftInput {
  date: string;
  name: string;
  type: string;
  durationMinutes: number;
  caloriesKcal?: number;
  load?: number;
  averageHeartRate?: number;
  maxHeartRate?: number;
}

export interface WorkoutReviseInput extends WorkoutDraftInput {
  workoutId: string;
  reason: string;
}

export function isInactiveLabel(workout: WorkoutSession) {
  if (workout.status === "void") return "已作废";
  if (workout.status === "superseded") return "已更正";
  if (workout.status === "reverted") return "已撤销更正";
  return "";
}

/** 提交前的本地校验；返回空对象表示通过。 */
export function validateWorkoutDraft(input: WorkoutDraftInput): { error?: string } {
  const name = input.name.trim();
  if (!name) return { error: "请填写课程或训练名称。" };
  if (name.length > WORKOUT_NAME_LIMIT) return { error: `训练名称不能超过 ${WORKOUT_NAME_LIMIT} 字。` };

  const type = input.type.trim();
  if (!type) return { error: "请填写运动类型。" };
  if (type.length > WORKOUT_TYPE_LIMIT) return { error: `运动类型不能超过 ${WORKOUT_TYPE_LIMIT} 字。` };

  const duration = input.durationMinutes;
  if (!Number.isFinite(duration) || duration < WORKOUT_DURATION_MIN || duration > WORKOUT_DURATION_MAX) {
    return { error: `运动时长需在 ${WORKOUT_DURATION_MIN}–${WORKOUT_DURATION_MAX} 分钟之间。` };
  }
  if (!Number.isInteger(duration)) return { error: "运动时长按整分钟记录。" };

  if (input.caloriesKcal !== undefined) {
    if (!Number.isFinite(input.caloriesKcal) || input.caloriesKcal < 0 || input.caloriesKcal > WORKOUT_CALORIES_MAX) {
      return { error: `运动消耗需在 0–${WORKOUT_CALORIES_MAX} kcal 之间。` };
    }
  }

  for (const [value, label] of [
    [input.averageHeartRate, "平均心率"],
    [input.maxHeartRate, "最高心率"],
  ] as const) {
    if (value === undefined) continue;
    if (!Number.isFinite(value) || value < WORKOUT_HEART_MIN || value > WORKOUT_HEART_MAX) {
      return { error: `${label}需在 ${WORKOUT_HEART_MIN}–${WORKOUT_HEART_MAX} 次/分之间；没有测量请留空。` };
    }
  }

  if (
    input.averageHeartRate !== undefined &&
    input.maxHeartRate !== undefined &&
    input.averageHeartRate > input.maxHeartRate
  ) {
    return { error: "平均心率不能高于最高心率。" };
  }

  return {};
}

/** 只把有值的可选项写进 payload，避免用 undefined 覆盖既有值。 */
export function workoutDraftPayload(input: WorkoutDraftInput): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    date: input.date,
    name: input.name.trim(),
    type: input.type.trim(),
    durationMinutes: input.durationMinutes,
  };
  if (input.caloriesKcal !== undefined) payload.caloriesKcal = input.caloriesKcal;
  if (input.load !== undefined) payload.load = input.load;
  if (input.averageHeartRate !== undefined) payload.averageHeartRate = input.averageHeartRate;
  if (input.maxHeartRate !== undefined) payload.maxHeartRate = input.maxHeartRate;
  return payload;
}

/**
 * 更正链的父子关系只认 `supersedesId` / `supersededBy` 两个指针。
 * 绝不能从 id 前缀反推：Rust 生成 `{kind}-{commandId}`，浏览器预览用 uid()，两套规则并存。
 */
export function correctionParent(
  workout: WorkoutSession,
  list: WorkoutSession[],
): WorkoutSession | null {
  if (!workout.supersedesId) return null;
  return list.find((item) => item.id === workout.supersedesId) ?? null;
}

/** 只有「当前有效、且父行确实还被自己替换着」的更正才允许撤销。 */
export function canUndoCorrection(workout: WorkoutSession, list: WorkoutSession[]) {
  if (!isActiveWorkout(workout) || !workout.supersedesId) return false;
  const parent = correctionParent(workout, list);
  if (!parent) return false;
  return parent.status === "superseded" && parent.supersededBy === workout.id;
}

/** 只有作废行能恢复；如果它本来是某次更正，链还得对得上，否则会出现父子双活。 */
export function canRestoreVoid(workout: WorkoutSession, list: WorkoutSession[]) {
  if (workout.status !== "void") return false;
  if (!workout.supersedesId) return true;
  const parent = correctionParent(workout, list);
  if (!parent) return false;
  return parent.status === "superseded" && parent.supersededBy === workout.id;
}

/**
 * 「上次练的是什么」：只从有效记录里找，日期不晚于所选日，按 日历日 → 录入时刻 取最新。
 * 作废 / 已更正 / 已撤销更正一律不作为来源，避免把错数据复制成新记录。
 */
export function latestActiveWorkout(list: WorkoutSession[], date: string): WorkoutSession | null {
  const candidates = list
    .filter((item) => isActiveWorkout(item) && item.date <= date)
    .slice()
    .sort((left, right) => {
      if (left.date !== right.date) return left.date < right.date ? 1 : -1;
      if (left.createdAt !== right.createdAt) return left.createdAt < right.createdAt ? 1 : -1;
      return left.id < right.id ? 1 : -1;
    });
  return candidates[0] ?? null;
}

/**
 * 把一条既有记录变成可再次提交的草稿：日期用调用方给的（通常是当前所选日），
 * 不带 id / createdAt / status / sourceFingerprint——指纹带过去会被 add_workout 判成重复。
 */
export function draftFromWorkout(workout: WorkoutSession, date: string): WorkoutDraftInput {
  const draft: WorkoutDraftInput = {
    date,
    name: workout.name,
    type: workout.type,
    durationMinutes: workout.durationMinutes,
  };
  if (workout.caloriesKcal !== undefined) draft.caloriesKcal = workout.caloriesKcal;
  if (workout.load !== undefined) draft.load = workout.load;
  if (workout.averageHeartRate !== undefined) draft.averageHeartRate = workout.averageHeartRate;
  if (workout.maxHeartRate !== undefined) draft.maxHeartRate = workout.maxHeartRate;
  return draft;
}
