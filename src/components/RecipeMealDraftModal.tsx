import { CalendarDays, UtensilsCrossed } from "lucide-react";
import { useMemo, useState } from "react";
import { diaryToday } from "../domain/diary";
import { missingNutrientKeys, summarizeMeals } from "../domain/calculations";
import { calculateFoodPortion, foodUnitLabels } from "../domain/foodLibrary";
import { totalNutrient } from "../domain/nutritionDisplay";
import {
  nutrientKeys,
  type FoodUnit,
  type MealEntry,
  type MealType,
  type NutritionFacts,
  type RecipeMealInput,
  type RecipeVersion,
} from "../domain/types";
import { useAppStore } from "../store/appStore";
import { Modal } from "./Modal";
import { useConfirmedAction } from "./useConfirmedAction";
import { useEnergyUnit } from "../hooks/useEnergyUnit";
import { energyUnitLabels } from "../domain/energyDisplay";

const mealLabels: Record<MealType, string> = { breakfast: "早餐", lunch: "午餐", dinner: "晚餐", snack: "加餐" };
const nutrientLabels: Record<(typeof nutrientKeys)[number], string> = { calories: "热量", protein: "蛋白质", carbohydrates: "碳水", fat: "脂肪", fiber: "纤维", sugar: "糖", sodium: "钠" };

/** 数量显示：内部全精度，展示去掉无意义尾零。 */
const quantityText = (value: number) => (Number.isFinite(value) ? String(Number(value.toFixed(4))) : "");

interface RowPreview {
  name: string;
  facts?: NutritionFacts;
  error?: string;
}

/**
 * 菜谱快速入餐草稿：把菜谱版本按「本次食用比例」带入目标日期与餐次。
 * ×1 = 菜谱完整配方量，不代表一人份；整体缩放按配方量重置各项，
 * 之后可逐项微调或去掉本次没吃的原料。预览与保存共用同一版本快照口径。
 */
export function RecipeMealDraftModal({
  recipe,
  initialType = "breakfast",
  initialDate,
  onClose,
  onRecorded,
}: {
  recipe: RecipeVersion;
  initialType?: MealType;
  initialDate?: string;
  onClose: () => void;
  onRecorded?: (date: string) => void;
}) {
  const [type, setType] = useState<MealType>(initialType);
  const [date, setDate] = useState(initialDate ?? diaryToday());
  const bases = useMemo(() => recipe.ingredients.map((item) => item.nutritionQuantity ?? item.amount), [recipe]);
  const [quantities, setQuantities] = useState<string[]>(() => recipe.ingredients.map((item) => quantityText(item.nutritionQuantity ?? item.amount)));
  const [units, setUnits] = useState<FoodUnit[]>(() => recipe.ingredients.map((item) => (item.nutritionUnit ?? item.unit) as FoodUnit));
  const [excluded, setExcluded] = useState<boolean[]>(() => recipe.ingredients.map(() => false));
  const [scale, setScale] = useState("1");
  const action = useConfirmedAction();
  const recordRecipeMeal = useAppStore((state) => state.recordRecipeMeal);
  const [displayUnit] = useEnergyUnit();

  function applyScale(factor: number) {
    if (!Number.isFinite(factor) || factor <= 0) return;
    setScale(String(factor));
    setQuantities(bases.map((base, index) => (excluded[index] ? quantities[index] : quantityText(base * factor))));
  }

  const previews: (RowPreview | null)[] = recipe.ingredients.map((ingredient, index) => {
    if (excluded[index]) return null;
    const version = ingredient.foodSnapshot?.version;
    if (!version) return { name: ingredient.name, error: "该原料缺少营养版本快照，无法带入。" };
    const quantity = Number(quantities[index]);
    if (!Number.isFinite(quantity) || quantity <= 0) return { name: ingredient.name, error: "数量必须是大于 0 的数值。" };
    try {
      return { name: ingredient.name, facts: calculateFoodPortion(version, quantity, units[index]).nutrition };
    } catch (cause) {
      return { name: ingredient.name, error: String(cause) };
    }
  });

  const draftEntries: MealEntry[] = previews.flatMap((item, index) =>
    item?.facts ? [{ id: `draft-${index}`, date, type, name: item.name, amountLabel: "", nutrition: item.facts, consumedRatio: 1, source: "manual", confidence: "high", createdAt: "" }] : [],
  );
  const summary = summarizeMeals(draftEntries);
  const missing = missingNutrientKeys(draftEntries);
  const included = previews.filter((item) => item?.facts).length;
  const blocked = previews.some((item) => item?.error);
  const ready = included > 0 && !blocked;

  async function confirm() {
    const input: RecipeMealInput = {
      date,
      type,
      recipeVersionId: recipe.id,
      entries: recipe.ingredients.flatMap((ingredient, index) =>
        !excluded[index] && previews[index]?.facts && ingredient.foodVersionId
          ? [{ foodVersionId: ingredient.foodVersionId, quantity: Number(quantities[index]), unit: units[index] }]
          : [],
      ),
    };
    const result = await action.run(JSON.stringify(input), (id) => recordRecipeMeal(input, id));
    if (!result.error) { onRecorded?.(date); onClose(); }
  }

  return (
    <Modal title={`加入餐次 · ${recipe.name}`} onClose={() => { if (!action.busy) onClose(); }}>
      <div className="recipe-draft">
        <p className="form-hint">
          <strong>×1 = 菜谱完整配方量，不代表一人份。</strong>整体缩放会按配方量重置各项数值，之后可逐项微调，或去掉本次没吃的原料。
        </p>

        <div className="recipe-draft-scale" role="group" aria-label="整体食用比例">
          <span>本次食用比例</span>
          {[0.5, 1, 2].map((factor) => (
            <button key={factor} className={`button small ${Number(scale) === factor ? "primary" : "secondary"}`} disabled={action.busy} onClick={() => applyScale(factor)}>
              ×{factor}
            </button>
          ))}
          <label><span>自定义</span><input type="number" min="0" step="any" aria-label="自定义食用比例" value={scale} disabled={action.busy} onChange={(event) => { setScale(event.target.value); applyScale(Number(event.target.value)); }} /></label>
        </div>

        <div className="recipe-draft-rows">
          {recipe.ingredients.map((ingredient, index) => {
            const version = ingredient.foodSnapshot?.version;
            const preview = previews[index];
            const unitOptions = version ? [version.basis.unit, ...version.conversions.map((item) => item.unit)] : [];
            return (
              <div className={`draft-row${excluded[index] ? " excluded" : ""}`} key={index}>
                <label className="checkbox-label">
                  <input type="checkbox" checked={!excluded[index]} disabled={action.busy} onChange={(event) => setExcluded((items) => items.map((value, itemIndex) => (itemIndex === index ? !event.target.checked : value)))} />
                  <span>{ingredient.name}</span>
                </label>
                {!excluded[index] && (version ? (
                  <div className="draft-row-controls">
                    <input type="number" min="0" step="any" aria-label={`${ingredient.name}数量`} value={quantities[index]} disabled={action.busy} onChange={(event) => setQuantities((items) => items.map((value, itemIndex) => (itemIndex === index ? event.target.value : value)))} />
                    <select aria-label={`${ingredient.name}单位`} value={units[index]} disabled={action.busy} onChange={(event) => setUnits((items) => items.map((value, itemIndex) => (itemIndex === index ? (event.target.value as FoodUnit) : value)))}>
                      {unitOptions.map((unit) => <option key={unit} value={unit}>{foodUnitLabels[unit]}</option>)}
                    </select>
                    <small>{preview?.facts ? (preview.facts.calories.state === "unknown" ? "热量未知" : `${Math.round(preview.facts.calories.value ?? 0)} ${energyUnitLabels[displayUnit]}`) : preview?.error}</small>
                  </div>
                ) : (
                  <small className="form-error">{preview?.error ?? "该原料缺少营养版本快照，无法带入。"}</small>
                ))}
              </div>
            );
          })}
        </div>

        <div className="basket-summary" aria-label="本批营养合计">
          <strong>本批合计 · {included} 项</strong>
          <div className="basket-summary-grid">
            {nutrientKeys.map((key) => {
              const display = totalNutrient(summary, key, { entryCount: draftEntries.length, missing: missing.includes(key) }, displayUnit);
              const unit = key === "calories" ? energyUnitLabels[displayUnit] : key === "sodium" ? "mg" : "g";
              return <span key={key}>{nutrientLabels[key]} <b className={display.state === "unknown" ? "basket-unknown" : ""} title={display.title}>{display.text}</b>{display.state === "unknown" ? "" : ` ${unit}`}</span>;
            })}
          </div>
          <p className="form-hint">「未知」不按 0 计入；「≥」为已知项小计。预览与最终保存使用同一食材版本口径。</p>
        </div>

        <div className="form-grid">
          <label><span><CalendarDays size={13} /> 进食日期</span><input type="date" required max={diaryToday()} value={date} disabled={action.busy} onChange={(event) => setDate(event.target.value)} /></label>
          <label><span>餐次</span><select value={type} disabled={action.busy} onChange={(event) => setType(event.target.value as MealType)}>{Object.entries(mealLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        </div>

        {action.message && <p className="form-error" role="alert">{action.message}</p>}
        <button className="button primary wide" disabled={action.busy || !ready || !date || date > diaryToday()} onClick={confirm}>
          <UtensilsCrossed size={15} /> {action.busy ? "正在保存…" : `确认写入 ${included} 项食物`}
        </button>
        <p className="form-hint">保存失败会保留草稿，可直接重试。若应用异常终止，重开后请先核对目标餐次再决定是否重记；万一重复，用条目「作废」移除并留痕。</p>
        {!ready && <p className="form-hint">至少保留一项可带入的原料，并修正数量后才能确认。</p>}
      </div>
    </Modal>
  );
}
