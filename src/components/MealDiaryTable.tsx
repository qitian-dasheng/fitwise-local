import { Copy, Plus } from "lucide-react";
import type { MealEntry, MealType, NutrientKey } from "../domain/types";
import { activeMeals, groupMealsByType, missingNutrientKeys, summarizeMeals } from "../domain/calculations";
import { mealLabels, type MealCopySource } from "../domain/meals";
import { normalizeAmountLabel } from "../domain/foodLibrary";
import {
  columnUnit,
  columns,
  entryNutrient,
  mealBrand,
  totalNutrient,
  type NutrientColumn,
  type NutrientDisplay,
} from "../domain/nutritionDisplay";
import { useEnergyUnit } from "../hooks/useEnergyUnit";

interface MealDiaryTableProps {
  date: string;
  entries: MealEntry[];
  showSodium: boolean;
  /** 中性参考小字，例如「目标约 100 g」；不参与达标判断。 */
  notes?: Partial<Record<NutrientKey, string>>;
  onSodiumChange: (visible: boolean) => void;
  onAdd: (type: MealType) => void;
  /** 每个餐次「照搬上次」的来源；没有可照搬的就不显示入口。 */
  copySources?: Partial<Record<MealType, MealCopySource | null>>;
  onCopy?: (type: MealType, source: MealCopySource) => void;
  onEdit: (entry: MealEntry) => void;
  onVoid: (entry: MealEntry) => void;
}

const cellClass = (display: NutrientDisplay) =>
  ["diary-cell-num", display.state === "unknown" ? "diary-unknown" : "", display.state === "partial" ? "diary-partial" : "", display.state === "none" ? "diary-none" : ""]
    .filter(Boolean)
    .join(" ");

/**
 * 0.9.4 第二轮：餐次卡片化。日合计独立卡置顶，四餐卡横排（卡内面板内滚），
 * 替代原「一张大表」。对外 props 不变；data-meal-type / data-nutrient / .food-entry
 * 锚点保留，供测试与键盘定位。
 */
export function MealDiaryTable({
  date,
  entries,
  showSodium,
  notes,
  onSodiumChange,
  onAdd,
  copySources,
  onCopy,
  onEdit,
  onVoid,
}: MealDiaryTableProps) {
  const active = activeMeals(entries).filter((entry) => entry.date === date);
  const groups = groupMealsByType(active);
  const summary = summarizeMeals(active);
  const missing = missingNutrientKeys(active);
  const cols = columns(showSodium);
  const [energyUnit] = useEnergyUnit();
  const unitOf = (column: NutrientColumn) => columnUnit(column.key, energyUnit, column.unit);
  const summaryClass = `diary-summary${showSodium ? " with-sodium" : ""}`;
  const isEmpty = active.length === 0;
  const status = isEmpty
    ? { tone: "neutral", label: "尚无记录" }
    : missing.length
      ? { tone: "warning", label: "未完整" }
      : { tone: "success", label: "数据完整" };

  return (
    <div className="diary-board">
      <section className="ui-card diary-total-card">
        <div className="card-heading compact">
          <div>
            <p className="eyebrow">{date} 明细</p>
            <h2>日合计</h2>
          </div>
          <div className="diary-card-tools">
            <label className="checkbox-label diary-sodium-toggle">
              <input type="checkbox" checked={showSodium} onChange={(event) => onSodiumChange(event.target.checked)} />
              <span>显示钠（mg）</span>
            </label>
            <span className="status-pill neutral">{active.length} 条</span>
          </div>
        </div>

        <div className={summaryClass}>
          <div className="diary-summary-lead">
            <strong>{isEmpty ? "尚无记录" : `${active.length} 条记录`}</strong>
            <span>热量覆盖率 {summary.coverage.calories}%</span>
            {/* 空日已经在上一行写了「尚无记录」，不再重复一个同文徽标。 */}
            {!isEmpty && <span className={`status-pill ${status.tone}`}>{status.label}</span>}
          </div>
          {cols.map((column) => {
            const display = totalNutrient(summary, column.key, { entryCount: active.length, missing: missing.includes(column.key) }, energyUnit);
            return (
              <div className="diary-summary-cell" key={column.key} data-nutrient={column.key}>
                <span>{column.label}</span>
                <b className={cellClass(display)} title={display.title}>
                  {display.text}
                </b>
                <small>
                  {unitOf(column)}
                  {notes?.[column.key] ? ` · ${notes[column.key]}` : ""}
                </small>
              </div>
            );
          })}
        </div>
        <p className="diary-legend">
          「未知」表示这条记录没有提供该营养，不计为 0；「≥」表示已知项小计，仍有记录未计入。
        </p>
      </section>

      <div className="meal-cards">
        {groups.map((group) => {
          const groupMissing = missingNutrientKeys(group.entries);
          // 空餐次不铺一排「—」：营养格会变成 6–7 个破折号，视觉噪音大于信息量。
          const isEmptyMeal = group.entries.length === 0;
          const copySource = isEmptyMeal ? copySources?.[group.type] ?? null : null;
          const calorieTotal = isEmptyMeal
            ? null
            : totalNutrient(group.summary, "calories", { entryCount: group.entries.length, missing: groupMissing.includes("calories") }, energyUnit);
          const proteinTotal = isEmptyMeal
            ? null
            : totalNutrient(group.summary, "protein", { entryCount: group.entries.length, missing: groupMissing.includes("protein") }, energyUnit);
          return (
            <section className={`ui-card meal-card${isEmptyMeal ? " empty" : ""}`} data-meal-type={group.type} key={group.type}>
              <header className="meal-card-head">
                <div className="meal-card-title">
                  <h3>{mealLabels[group.type]}</h3>
                  <span className="meal-card-sub">
                    {isEmptyMeal ? "还没有记录" : `${group.entries.length} 项`}
                    {calorieTotal && (
                      <>
                        {" "}· 小计 <b data-nutrient="calories" className={cellClass(calorieTotal)} title={calorieTotal.title}>{calorieTotal.text}</b> {unitOf(cols[0])}
                      </>
                    )}
                    {proteinTotal && (
                      <>
                        {" "}· 蛋白 <b data-nutrient="protein" className={cellClass(proteinTotal)} title={proteinTotal.title}>{proteinTotal.text}</b> g
                      </>
                    )}
                  </span>
                </div>
                <div className="meal-card-actions">
                  <button className="text-button" onClick={() => onAdd(group.type)}>
                    <Plus size={13} /> 添加{mealLabels[group.type]}
                  </button>
                  {copySource && (
                    <button
                      className="text-button diary-empty-hint"
                      title={`把 ${copySource.date} 的${mealLabels[group.type]} ${copySource.entries.length} 项复制到这一天`}
                      onClick={() => onCopy?.(group.type, copySource)}
                    >
                      <Copy size={13} /> 照搬 {copySource.date.slice(5)} · {copySource.entries.length} 项
                    </button>
                  )}
                </div>
              </header>

              {!isEmptyMeal && (
                <div className="meal-card-items">
                  {group.entries.map((entry) => {
                    const brand = mealBrand(entry);
                    const calorie = entryNutrient(entry, "calories", energyUnit);
                    return (
                      // .food-entry 保留给既有结构断言；卡片化的单条记录锚点。
                      <article className="meal-card-item food-entry" key={entry.id}>
                        <div className="meal-card-item-head">
                          <strong>{entry.name}</strong>
                          <b data-nutrient="calories" className={cellClass(calorie)} title={calorie.title}>
                            {calorie.text}
                            <small> {unitOf(cols[0])}</small>
                          </b>
                        </div>
                        <div className="meal-card-item-tags">
                          <span>{[brand, normalizeAmountLabel(entry.amountLabel)].filter(Boolean).join(" · ")}</span>
                          <span className={`status-pill ${entry.confidence === "high" ? "success" : "neutral"}`}>
                            {entry.confidence === "high" ? "已确认" : "估算"}
                          </span>
                          {entry.consumedRatio < 1 && (
                            <span className="status-pill neutral">按 {Math.round(entry.consumedRatio * 100)}% 计入</span>
                          )}
                        </div>
                        <div className="meal-card-item-foot">
                          <span className="meal-card-item-nutrients">
                            {cols.slice(1).map((column) => {
                              const display = entryNutrient(entry, column.key, energyUnit);
                              return (
                                <em key={column.key} data-nutrient={column.key} className={cellClass(display)} title={display.title}>
                                  {display.text}
                                  <small> {unitOf(column)}</small>
                                </em>
                              );
                            })}
                          </span>
                          <span className="meal-card-item-actions">
                            <button className="text-button" onClick={() => onEdit(entry)}>
                              编辑
                            </button>
                            <button className="text-button warning-text" onClick={() => onVoid(entry)}>
                              作废
                            </button>
                          </span>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
