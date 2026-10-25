import { useState } from "react";
import { Check, PencilLine, Trash2 } from "lucide-react";
import { useFoodPicker } from "../store/foodPicker";
import { useAppStore } from "../store/appStore";
import { calculateFoodPortion } from "../domain/foodLibrary";
import { missingNutrientKeys, summarizeMeals } from "../domain/calculations";
import { totalNutrient } from "../domain/nutritionDisplay";
import { nutrientKeys, type FoodMealInput, type MealEntry, type MealType } from "../domain/types";
import { mealLabels } from "../domain/meals";
import { diaryToday } from "../domain/diary";
import { useConfirmedAction } from "./useConfirmedAction";
import { MiniSelect } from "./MiniSelect";

/**
 * 0.9.4 第六轮分离式重设计：核对与确认从记餐弹窗迁到饮食页本条。
 * 收起态一行摘要 + 确认按钮；展开态批次合计、行内改量、移除与日期/餐次。
 * 篮子在跨页 store（食材库建档往返不丢），空则整条隐藏。
 */
const nutrientLabels = { calories: "能量", protein: "蛋白质", carbohydrates: "碳水化合物", fat: "脂肪", fiber: "膳食纤维", sugar: "糖", sodium: "钠" };

export function BasketBar({ onRecorded }: { onRecorded?: (date: string) => void }) {
  const basket = useFoodPicker((picker) => picker.basket);
  const setBasket = useFoodPicker((picker) => picker.setBasket);
  const clearBasket = useFoodPicker((picker) => picker.clearBasket);
  const recordFoodMeal = useAppStore((state) => state.recordFoodMeal);
  const foodDefinitionVersions = useAppStore((state) => state.foodDefinitionVersions);
  const action = useConfirmedAction();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(diaryToday());
  const [type, setType] = useState<FoodMealInput["type"]>("breakfast");
  const [editingBasket, setEditingBasket] = useState<number | null>(null);

  if (basket.length === 0) return null;

  const mealEntries: MealEntry[] = basket.map((entry, index) => ({ id: `basket-${index}`, date, type, name: entry.name, amountLabel: "", nutrition: entry.facts, consumedRatio: 1, source: "manual", confidence: "high", createdAt: "" }));
  const summary = summarizeMeals(mealEntries);
  const missing = missingNutrientKeys(mealEntries);
  const kcalTotal = totalNutrient(summary, "calories", { entryCount: basket.length, missing: missing.includes("calories") }, "kcal");

  function updateQuantity(index: number, raw: string) {
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) return;
    const entry = basket[index];
    const version = foodDefinitionVersions.find((item) => item.id === entry.foodVersionId);
    if (!version) return;
    try {
      const facts = calculateFoodPortion(version, value, entry.unit).nutrition;
      setBasket((items) => items.map((item, itemIndex) => (itemIndex === index ? { ...item, quantity: value, facts } : item)));
    } catch { /* 换算失败保留原值，不静默写入错误营养 */ }
  }

  async function confirm() {
    const input: FoodMealInput = { date, type, entries: basket.map(({ foodVersionId, quantity, unit }) => ({ foodVersionId, quantity, unit })) };
    const result = await action.run(JSON.stringify(input), (id) => recordFoodMeal(input, id));
    if (!result.error) {
      clearBasket();
      setOpen(false);
      onRecorded?.(date);
    }
  }

  return (
    <section className="ui-card basket-bar" aria-label="待确认篮子">
      <div className="basket-bar-row">
        <strong>待确认篮子 · {basket.length} 项</strong>
        <span className="basket-bar-total">合计 {kcalTotal.text} kcal{kcalTotal.state !== "known" ? "（含未知）" : ""}</span>
        <button className="text-button" onClick={() => setOpen((value) => !value)}>{open ? "收起" : "展开核对"}</button>
        <button className="button primary small" disabled={action.busy || !date || date > diaryToday()} onClick={() => void confirm()}>
          {action.busy ? "正在保存…" : `确认写入 ${basket.length} 项`}
        </button>
      </div>
      {/* 保存失败提示在收起态也可见——失败后用户第一眼要看到原因。 */}
      {action.message && <p className="form-error" role="alert">{action.message}</p>}

      {open && (
        <div className="basket-bar-body">
          {basket.length > 0 && (
            <div className="basket-summary" aria-label="本批营养合计">
              <strong>本批合计 · {basket.length} 项</strong>
              <div className="basket-summary-grid">
                {nutrientKeys.map((key) => {
                  const display = totalNutrient(summary, key, { entryCount: basket.length, missing: missing.includes(key) }, "kcal");
                  const unit = key === "calories" ? "kcal" : key === "sodium" ? "mg" : "g";
                  return <span key={key}>{nutrientLabels[key]} <b className={display.state === "unknown" ? "basket-unknown" : ""} title={display.title}>{display.text}</b>{display.state === "unknown" ? "" : ` ${unit}`}</span>;
                })}
              </div>
              <span className="basket-summary-legend">「未知」不按 0 计入；「≥」为已知项小计。</span>
            </div>
          )}
          {basket.map((entry, index) => (
            <div className="basket-row" key={index}>
              <div>
                <strong>{entry.name}</strong>
                <span>
                  {editingBasket === index
                    ? <span className="basket-edit"><input type="number" min="0" step="any" aria-label={`修改${entry.name}的数量`} defaultValue={entry.quantity} onChange={(event) => updateQuantity(index, event.target.value)} /><button className="icon-button" aria-label="完成修改" onClick={() => setEditingBasket(null)}><Check size={15}/></button></span>
                    : `${entry.quantity} ${entry.unit === "piece" ? "个" : entry.unit === "ml" ? "毫升" : entry.unit === "serving" ? "份" : entry.unit === "package" ? "包装" : "克"} · ${entry.facts.calories.state === "known" ? `${entry.facts.calories.value} kcal` : "未知 kcal"}`}
                </span>
              </div>
              <span className="basket-actions">
                {editingBasket !== index && <button className="icon-button" aria-label={`修改${entry.name}数量`} disabled={action.busy} onClick={() => setEditingBasket(index)}><PencilLine size={15}/></button>}
                <button className="icon-button" aria-label={`移除${entry.name}`} disabled={action.busy} onClick={() => { setBasket((items) => items.filter((_, itemIndex) => itemIndex !== index)); if (editingBasket === index) setEditingBasket(null); }}><Trash2 size={16}/></button>
              </span>
            </div>
          ))}
          <div className="form-grid">
            <label><span>日期</span><input type="date" required max={diaryToday()} value={date} onChange={(event) => setDate(event.target.value)}/></label>
            <label><span>餐次</span><MiniSelect ariaLabel="餐次" value={type} onChange={(value) => setType(value as MealType)}
              options={Object.entries(mealLabels).map(([value, label]) => ({ value, label }))} /></label>
          </div>
          <p className="form-hint">保存失败会保留待确认内容，可直接重试；万一重复用日报条目「作废」移除。</p>
        </div>
      )}
    </section>
  );
}
