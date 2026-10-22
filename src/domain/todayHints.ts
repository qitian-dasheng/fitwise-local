/**
 * 今日页「补记一笔」三个入口的副标题。
 *
 * 这一处以前是三条写死的假数据（「照搬上次早餐」「上次 22 分钟」「今晨还没称」）：
 * 只改一次文案治不好，任何静态文案在数据变化后都会变成新的谎话。
 * 所以把三个副标题全部改成从真实记录算出来的状态，文案只是状态的渲染结果。
 */

import type { BodyMeasurement, MealEntry, MealType, WorkoutSession } from "./types";
import { mealLabels, nextMealSlot } from "./meals";
import { latestActiveWorkout } from "./workouts";
import { dailyRepresentatives } from "./body";

/** 训练名称在副标题里的显示上限；课程名可写 80 字，超长会把整行挤没。 */
const WORKOUT_NAME_HINT_LIMIT = 8;

/** 按字算长度：空格不算宽度，否则「Keep B4 手环…」会被截成「Keep B…」这种看不懂的样子。 */
function ellipsis(text: string, limit: number) {
  const trimmed = text.trim().replace(/\s+/g, " ");
  let visible = 0;
  for (let index = 0; index < trimmed.length; index += 1) {
    if (trimmed[index] !== " ") visible += 1;
    if (visible > limit) return `${trimmed.slice(0, index).trim()}…`;
  }
  return trimmed;
}

export interface MealActionHint {
  /** 点击后应该打开的餐次；四餐都记满时为 null，此时退回早餐表单。 */
  slot: MealType | null;
  text: string;
}

/**
 * 「吃了什么」：说清下一个待记的餐次。
 *
 * 不写「照搬上次早餐」——点这个按钮只是打开餐次表单，并不会复制任何东西；
 * 照搬入口在饮食页的餐次行里，那里才真的有可复制的来源。
 */
export function mealActionHint(meals: MealEntry[], date: string): MealActionHint {
  const slot = nextMealSlot(meals, date);
  if (!slot) return { slot: null, text: "四餐都已记录" };
  return { slot, text: `${mealLabels[slot]}还没记` };
}

/** 「练了什么」：所选日已记就说当日分钟数，否则报最近一次有效训练的名字与时长。 */
export function workoutActionHint(workouts: WorkoutSession[], date: string): string {
  const latest = latestActiveWorkout(workouts, date);
  if (!latest) return "还没有训练记录";
  const minutes = `${latest.durationMinutes} 分钟`;
  if (latest.date === date) return `今日已记 ${minutes}`;
  return `上次 ${ellipsis(latest.name, WORKOUT_NAME_HINT_LIMIT)} · ${minutes}`;
}

/**
 * 「称了多少」：有当日代表值就报数，没有时才说没称。
 *
 * 「今晨」只在看今天时成立；翻历史日报时那句话是假的，所以区分两种说法。
 */
export function bodyActionHint(measurements: BodyMeasurement[], date: string, today: string): string {
  const sameDay = dailyRepresentatives(measurements).find((item) => item.date === date);
  if (sameDay) return `已记 ${sameDay.weightKg.toFixed(1)} kg`;
  return date === today ? "今晨还没称重" : "所选日没有称重";
}
