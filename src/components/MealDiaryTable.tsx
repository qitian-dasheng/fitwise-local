import { Copy, Plus } from "lucide-react";
import type { MealEntry, MealType, NutrientKey } from "../domain/types";
import { activeMeals, groupMealsByType, missingNutrientKeys, summarizeMeals } from "../domain/calculations";
import { mealLabels, type MealCopySource } from "../domain/meals";
import {
  columns,
  entryNutrient,
  mealBrand,
  totalNutrient,
  type NutrientColumn,
  type NutrientDisplay,
} from "../domain/nutritionDisplay";

interface MealDiaryTableProps {
  date: string;
  entries: MealEntry[];
  showSodium: boolean;
  batchCount: number;
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

function NumberCell({ display, column }: { display: NutrientDisplay; column: NutrientColumn }) {
  return (
    <span className={cellClass(display)} title={display.title} data-nutrient={column.key}>
      {display.text}
    </span>
  );
}

export function MealDiaryTable({
  date,
  entries,
  showSodium,
  batchCount,
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
  const tableClass = `diary-table${showSodium ? " with-sodium" : ""}`;
  const summaryClass = `diary-summary${showSodium ? " with-sodium" : ""}`;
  const isEmpty = active.length === 0;
  const status = isEmpty
    ? { tone: "neutral", label: "尚无记录" }
    : missing.length
      ? { tone: "warning", label: "未完整" }
      : { tone: "success", label: "数据完整" };

  return (
    <section className="card diary-card">
      <div className="card-heading compact">
        <div>
          <p className="eyebrow">{date} 明细</p>
          <h2>按餐次记录</h2>
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
          <p className="eyebrow">日合计</p>
          <strong>{isEmpty ? "尚无记录" : `${active.length} 条记录`}</strong>
          <span>
            {batchCount} 个已确认批次 · 热量覆盖率 {summary.coverage.calories}%
          </span>
          {/* 空日已经在上一行写了「尚无记录」，不再重复一个同文徽标。 */}
          {!isEmpty && <span className={`status-pill ${status.tone}`}>{status.label}</span>}
        </div>
        {cols.map((column) => {
          const display = totalNutrient(summary, column.key, { entryCount: active.length, missing: missing.includes(column.key) });
          return (
            <div className="diary-summary-cell" key={column.key} data-nutrient={column.key}>
              <span>{column.label}</span>
              <b className={cellClass(display)} title={display.title}>
                {display.text}
              </b>
              <small>
                {column.unit}
                {notes?.[column.key] ? ` · ${notes[column.key]}` : ""}
              </small>
            </div>
          );
        })}
      </div>

      <div className="diary-scroll">
        <div className={tableClass}>
          <div className="diary-row diary-head">
            <span className="diary-cell-food">食物 / 份量</span>
            {cols.map((column) => (
              <span className="diary-cell-num" key={column.key}>
                {column.label} {column.unit}
              </span>
            ))}
            <span className="diary-cell-actions">操作</span>
          </div>

          {groups.map((group) => {
            const groupMissing = missingNutrientKeys(group.entries);
            // 空餐次不铺一排「—」：营养格会变成 6–7 个破折号，视觉噪音大于信息量。
            const isEmptyMeal = group.entries.length === 0;
            const copySource = isEmptyMeal ? copySources?.[group.type] ?? null : null;
            return (
              <div className="diary-meal" data-meal-type={group.type} key={group.type}>
                <div className={`diary-row diary-meal-head${isEmptyMeal ? " diary-meal-head-empty" : ""}`}>
                  <div className="diary-cell-food">
                    <strong>{mealLabels[group.type]}</strong>
                    <small>{isEmptyMeal ? "还没有记录" : `${group.entries.length} 项`}</small>
                  </div>
                  {isEmptyMeal ? (
                    <div className="diary-empty-actions">
                      <button className="text-button diary-empty-hint" onClick={() => onAdd(group.type)}>
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
                  ) : (
                    <>
                      {cols.map((column) => {
                        const display = totalNutrient(group.summary, column.key, {
                          entryCount: group.entries.length,
                          missing: groupMissing.includes(column.key),
                        });
                        return <NumberCell column={column} display={display} key={column.key} />;
                      })}
                      <div className="diary-cell-actions">
                        <button className="text-button" onClick={() => onAdd(group.type)}>
                          <Plus size={13} /> 添加{mealLabels[group.type]}
                        </button>
                      </div>
                    </>
                  )}
                </div>

                {group.entries.map((entry) => {
                  const brand = mealBrand(entry);
                  return (
                    // .food-entry 保留给既有结构断言；B2 再统一改名。
                    <div className="diary-row diary-item food-entry" key={entry.id}>
                      <div className="diary-cell-food">
                        <strong>{entry.name}</strong>
                        <span>{[brand, entry.amountLabel].filter(Boolean).join(" · ")}</span>
                        <small className="diary-item-tags">
                          <span className={`status-pill ${entry.confidence === "high" ? "success" : "neutral"}`}>
                            {entry.confidence === "high" ? "已确认" : "估算"}
                          </span>
                          {entry.consumedRatio < 1 && (
                            <span className="status-pill neutral">按 {Math.round(entry.consumedRatio * 100)}% 计入</span>
                          )}
                        </small>
                      </div>
                      {cols.map((column) => (
                        <NumberCell column={column} display={entryNutrient(entry, column.key)} key={column.key} />
                      ))}
                      <div className="diary-cell-actions">
                        <button className="text-button" onClick={() => onEdit(entry)}>
                          编辑
                        </button>
                        <button className="text-button warning-text" onClick={() => onVoid(entry)}>
                          作废
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      <p className="diary-legend">
        「未知」表示这条记录没有提供该营养，不计为 0；「≥」表示已知项小计，仍有记录未计入。
      </p>
    </section>
  );
}
