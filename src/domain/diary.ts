import { shanghaiDate } from "./purchases";

export const diaryToday = () => shanghaiDate();
export function shiftDiaryDate(date: string, days: number) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 864e5).toISOString().slice(0, 10);
}
export function ratioPercent(ratio: number) { return Number((ratio * 100).toFixed(2)); }
export interface DiaryDateProps { date?: string; onDateChange?: (date: string) => void }
export function isDemoPlan(id: string) { return /^plan-[123]$/.test(id); }
