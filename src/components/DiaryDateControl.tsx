import { ChevronLeft, ChevronRight } from "lucide-react";
import { diaryToday, shiftDiaryDate } from "../domain/diary";

export function DiaryDateControl({ date, onChange }: { date: string; onChange?: (date: string) => void }) {
  const today = diaryToday();
  return <div className="diary-date-control" role="group" aria-label="记录日期">
    <button className="icon-button" aria-label="前一天" disabled={!onChange} onClick={() => onChange?.(shiftDiaryDate(date, -1))}><ChevronLeft size={18}/></button>
    <label><span>记录日期</span><input aria-label="查看日期" type="date" required max={today} value={date} onChange={event => { if (/^\d{4}-\d{2}-\d{2}$/.test(event.target.value) && event.target.value <= today) onChange?.(event.target.value); }}/></label>
    <button className="icon-button" aria-label="后一天" disabled={!onChange || date >= today} onClick={() => onChange?.(shiftDiaryDate(date, 1))}><ChevronRight size={18}/></button>
    <button className="button secondary small" disabled={!onChange || date === today} onClick={() => onChange?.(today)}>回到今天</button>
    {date !== today && <small>正在查看历史记录；库存操作仍按当前实际发生时间记账。</small>}
  </div>;
}
