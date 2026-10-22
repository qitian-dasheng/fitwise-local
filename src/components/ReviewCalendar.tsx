import type { ReactNode } from "react";
import type { CalendarCell } from "../domain/review";
import { toDisplayEnergyMaybe } from "../domain/energyDisplay";

const STATUS_LABEL: Record<CalendarCell["status"], string> = {
  none: "没有记录",
  partial: "热量不全，无法判定",
  miss: "有记录但未达标",
  hit: "达标",
};

function cellTitle(cell: CalendarCell, energyUnit: "kcal" | "kJ") {
  const parts = [cell.date, STATUS_LABEL[cell.status]];
  if (cell.calories !== null) parts.push(`${Math.round(toDisplayEnergyMaybe(cell.calories, energyUnit) ?? 0)} ${energyUnit}`);
  if (cell.protein !== null) parts.push(`蛋白 ${Math.round(cell.protein)} g`);
  if (cell.complete) parts.push("已确认完整");
  if (cell.workoutCount > 0) parts.push(`运动 ${cell.workoutCount} 次`);
  return parts.join(" · ");
}

/**
 * 区间达标日历：一格一天。
 * 「达标」用严格口径（热量在目标区间内且蛋白达到目标），
 * 热量未知的那天单独标出来，不混进达标或未达标。
 * 传入 onSelect 时每格变成按钮，点了就跳到那一天；`selectLabel` 决定文案里说的是
 * 哪一页（饮食记录 / 身体记录 / 运动记录），避免「点了却说跳饮食」的错文案。
 */
export function ReviewCalendar({
  cells,
  onSelect,
  selectLabel = "饮食记录",
  headerAction,
  energyUnit = "kcal",
}: {
  cells: CalendarCell[];
  onSelect?: (date: string) => void;
  selectLabel?: string;
  headerAction?: ReactNode;
  /** 仅影响悬浮提示里热量的显示单位；达标判断口径不受影响。 */
  energyUnit?: "kcal" | "kJ";
}) {
  return (
    <section className="card review-calendar">
      <div className="card-heading compact">
        <div>
          <p className="eyebrow">严格口径 · 热量区间内且蛋白达标</p>
          <h2>达标日历</h2>
        </div>
        <div className="calendar-meta">
          {headerAction}
          <span className="calendar-total">{cells.filter((cell) => cell.status === "hit").length} 天达标</span>
        </div>
      </div>
      <div className="calendar-grid">
        {cells.map((cell) => {
          const className = `calendar-cell calendar-${cell.status}${cell.complete ? " calendar-complete" : ""}`;
          const label = cellTitle(cell, energyUnit);
          return onSelect ? (
            <button
              key={cell.date}
              type="button"
              className={className}
              title={`${label} · 点击查看这一天的${selectLabel}`}
              aria-label={`${label}，点击查看这一天的${selectLabel}`}
              onClick={() => onSelect(cell.date)}
            >
              <span>{Number(cell.date.slice(8, 10))}</span>
              {cell.workoutCount > 0 && <i className="calendar-dot" aria-hidden="true" />}
            </button>
          ) : (
            <div key={cell.date} className={className} title={label}>
              <span>{Number(cell.date.slice(8, 10))}</span>
              {cell.workoutCount > 0 && <i className="calendar-dot" aria-hidden="true" />}
            </div>
          );
        })}
      </div>
      {onSelect && (
        <p className="calendar-hint">点任意一格跳到那一天，查看当天的{selectLabel}。</p>
      )}
      <ul className="calendar-legend">
        <li><i className="calendar-cell calendar-hit" /> 达标</li>
        <li><i className="calendar-cell calendar-miss" /> 未达标</li>
        <li><i className="calendar-cell calendar-partial" /> 热量不全</li>
        <li><i className="calendar-cell calendar-none" /> 无记录</li>
        <li><i className="calendar-cell calendar-hit calendar-complete" /> 已确认完整</li>
        <li><i className="calendar-dot calendar-dot-legend" aria-hidden="true" /> 当日有运动</li>
      </ul>
    </section>
  );
}
