import { useMemo, useState } from "react";
import { Modal } from "./Modal";
import { useConfirmedAction } from "./useConfirmedAction";
import { useAppStore } from "../store/appStore";
import { activeMeals, entryRatio } from "../domain/calculations";
import { mealCopySourceOn, mealLabels, type MealCopySource } from "../domain/meals";
import type { MealType } from "../domain/types";
import { useEnergyUnit } from "../hooks/useEnergyUnit";
import { energyUnitLabels, toDisplayEnergyMaybe } from "../domain/energyDisplay";

/**
 * 照搬前的确认：把要复制哪几项、多少热量摆出来，避免一次误点抄进一堆数据。
 * 来源默认可照搬的历史日期（最近一天），也可切换到更早的任意一天。
 */
export function CopyMealModal({
  date,
  type,
  source,
  onClose,
}: {
  date: string;
  type: MealType;
  source: MealCopySource;
  onClose: () => void;
}) {
  const action = useConfirmedAction();
  const copyMeal = useAppStore((state) => state.copyMeal);
  const meals = useAppStore((state) => state.meals);
  const [energyUnit] = useEnergyUnit();
  const label = mealLabels[type];
  const candidateDates = useMemo(
    () =>
      [...new Set(activeMeals(meals).filter((entry) => entry.type === type && entry.date < date).map((entry) => entry.date))].sort().reverse(),
    [meals, type, date],
  );
  const [sourceDate, setSourceDate] = useState(source.date);
  const selected = mealCopySourceOn(meals, type, sourceDate) ?? source;

  return (
    <Modal title={`照搬 ${selected.date} 的${label}`} onClose={() => { if (!action.busy) onClose(); }}>
      <form
        className="form"
        onSubmit={async (event) => {
          event.preventDefault();
          const result = await action.run(
            JSON.stringify({ date, type, sourceDate: selected.date }),
            (id) => copyMeal({ date, type, sourceDate: selected.date }, id),
          );
          if (!result.error) onClose();
        }}
      >
        <fieldset className="library-fields" disabled={action.busy}>
          {candidateDates.length > 1 && (
            <label>
              <span>来源日期（{candidateDates.length} 天有记录）</span>
              <select value={sourceDate} disabled={action.busy} onChange={(event) => setSourceDate(event.target.value)}>
                {candidateDates.map((item) => (
                  <option key={item} value={item}>
                    {item}
                    {item === source.date ? "（最近）" : ""}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="ratio-summary">
            <div>
              <strong>
                {selected.entries.length} 项 · {selected.calories === null ? "热量未知" : `${Math.round(toDisplayEnergyMaybe(selected.calories, energyUnit) ?? 0)} ${energyUnitLabels[energyUnit]}`}
              </strong>
              <span>来自 {selected.date} 的{label}，复制到 {date}</span>
            </div>
          </div>
          <ul className="copy-meal-list">
            {selected.entries.map((entry) => {
              const calories = entry.nutrition.calories;
              const text =
                calories.state === "known" && calories.value !== undefined
                  ? `${Math.round(toDisplayEnergyMaybe(calories.value * entryRatio(entry), energyUnit) ?? 0)} ${energyUnitLabels[energyUnit]}`
                  : "热量未知";
              return (
                <li key={entry.id}>
                  <strong>{entry.name}</strong>
                  <span>{entry.amountLabel}</span>
                  <b>{text}</b>
                </li>
              );
            })}
          </ul>
          <p className="form-hint">
            只复制名称、份量与营养快照，沿用当时的食材版本；原来那口锅的批次关联不会跟过来，库存也不会因此变动。复制后可以照常编辑或作废；要改份量建议改存为菜谱后按比例加入。
          </p>
          {action.message && <p className="form-error" role="alert">{action.message}</p>}
          <button className="button primary wide" disabled={action.busy}>
            {action.busy ? "正在复制…" : `照搬 ${selected.entries.length} 项到 ${date.slice(5)}`}
          </button>
        </fieldset>
      </form>
    </Modal>
  );
}
