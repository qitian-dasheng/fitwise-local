import { shanghaiDate } from "./purchases";

export const diaryToday = () => shanghaiDate();
export function shiftDiaryDate(date: string, days: number) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 864e5).toISOString().slice(0, 10);
}

/** 含头含尾的天数：同一日期返回 1。日期非法或反向区间返回 0，让调用方能守住边界。 */
export function daySpan(start: string, end: string) {
  const from = Date.parse(`${start}T00:00:00Z`);
  const to = Date.parse(`${end}T00:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return 0;
  return Math.round((to - from) / 864e5) + 1;
}
export function ratioPercent(ratio: number) { return Number((ratio * 100).toFixed(2)); }
export interface DiaryDateProps { date?: string; onDateChange?: (date: string) => void }
export function isDemoPlan(id: string) { return /^plan-[123]$/.test(id); }
