import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Modal } from "./Modal";
import { FoodLibraryModal } from "./FoodLibraryModal";
import { useConfirmedAction } from "./useConfirmedAction";
import { useAppStore } from "../store/appStore";
import { calculateFoodPortion, foodBasisLabels, foodUnitLabels, nutrientLabel } from "../domain/foodLibrary";
import { previewRecipe } from "../domain/recipes";
import type { FoodUnit, InventoryLot, RecipeInput, RecipeVersion } from "../domain/types";

type Row = {
  key: string;
  foodVersionId: string;
  quantity: string;
  unit: FoodUnit;
  inventoryFoodId: string;
  inventoryUnit: InventoryLot["unit"];
  inventoryConfirmed: boolean;
  sourceName?: string;
  notice?: string;
};
const emptyRow = (): Row => ({
  key: crypto.randomUUID(), foodVersionId: "", quantity: "100", unit: "g",
  inventoryFoodId: "", inventoryUnit: "g", inventoryConfirmed: false,
});

export function RecipeEditor({ recipe, copyMode = false, onClose, onSaved }: {
  recipe?: RecipeVersion;
  copyMode?: boolean;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const state = useAppStore();
  const action = useConfirmedAction();
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [name, setName] = useState(copyMode && recipe ? `${recipe.name}（副本）` : recipe?.name ?? "");
  const [minutes, setMinutes] = useState(String(recipe?.totalMinutes ?? 30));
  const [equipment, setEquipment] = useState(recipe?.equipment ?? state.profile.equipment.slice(0, 1));
  const [rows, setRows] = useState<Row[]>(() => recipe ? recipe.ingredients.map(i => ({
    key: crypto.randomUUID(), foodVersionId: i.foodVersionId ?? "",
    quantity: String(i.nutritionQuantity ?? i.amount), unit: i.nutritionUnit ?? i.unit,
    inventoryFoodId: i.foodId, inventoryUnit: i.unit, inventoryConfirmed: false, sourceName: i.name,
  })) : [emptyRow()]);
  const patch = (key: string, changes: Partial<Row>) => setRows(current => current.map(r =>
    r.key === key ? { ...r, inventoryConfirmed: false, ...changes } : r));
  const input: RecipeInput = {
    ...(copyMode && recipe ? { copiedFromVersionId: recipe.id } : {}),
    name, totalMinutes: Number(minutes), equipment,
    ingredients: rows.map(({ foodVersionId, quantity, unit, inventoryFoodId, inventoryUnit, inventoryConfirmed }) => ({
      foodVersionId, quantity: Number(quantity), unit, inventoryFoodId, inventoryUnit, inventoryConfirmed,
    })),
    ...(recipe && !copyMode ? { recipeId: recipe.recipeId, expectedVersionId: recipe.id } : {}),
  };
  let preview: ReturnType<typeof previewRecipe> | undefined;
  let error = "";
  try { preview = previewRecipe(state, input); } catch (e) { error = String(e); }
  const missing = rows.filter(r => !state.foodDefinitionVersions.some(v => v.id === r.foodVersionId)).length;
  const catalogEmpty = !state.foodDefinitions.some(f => state.foodDefinitionVersions.some(v => v.id === f.activeVersionId));
  const canSave = !!name.trim() && name.length <= 120 && Number.isInteger(Number(minutes)) && Number(minutes) >= 1 && Number(minutes) <= 1440
    && !error && !!rows.length && rows.every(r => r.inventoryConfirmed) && !!equipment.length;
  const summary = copyMode
    ? "另存为独立菜谱，原配方不变；保存不扣库存、不记餐。"
    : recipe ? "保存为新版本，已有批次不变；保存不扣库存、不记餐。"
      : "保存为标准菜谱；实际制作、进食时再分别记账。";

  return <>
    <div hidden={libraryOpen}>
      <Modal title={copyMode ? `另存历史配方 · 来源 v${recipe?.version}` : recipe ? `修订菜谱 · v${recipe.version + 1}` : "新建标准菜谱"}
        onClose={() => { if (!action.busy) onClose(); }}>
        <form className="form recipe-editor" onSubmit={async e => {
          e.preventDefault();
          if (!canSave) return;
          const result = await action.run(JSON.stringify(input), id => state.saveRecipe(input, id));
          if (!result.error && result.recipeVersionId) { onSaved(result.recipeVersionId); onClose(); }
        }}>
          <fieldset className="library-fields" disabled={action.busy}>
            <p className="recipe-summary">{summary}</p>
            <div className="form-grid recipe-metadata">
              <label><span>菜谱名称</span><input required maxLength={120} value={name} onChange={e => setName(e.target.value)} /></label>
              <label><span>准备、烹饪与清洁总分钟</span><input required type="number" min="1" max="1440" step="1" value={minutes} onChange={e => setMinutes(e.target.value)} /></label>
            </div>
            <div className="recipe-catalog-bar">
              <button type="button" className="button secondary small" onClick={() => setLibraryOpen(true)}>管理／新建食材（保留菜谱输入）</button>
              {catalogEmpty ? <p className="recipe-context-note" role="status">食材库为空，先建档并核对规格，再返回选择原料。</p>
                : missing > 0 && <p className="recipe-context-note" role="status">还有 {missing} 项原料待关联，请逐项选择食材，不按同名猜测。</p>}
            </div>
            {rows.map((row, index) => {
              const version = state.foodDefinitionVersions.find(v => v.id === row.foodVersionId);
              const food = state.foodDefinitions.find(f => f.id === version?.foodId);
              const versions = state.foodDefinitionVersions.filter(v => state.foodDefinitions.some(f =>
                f.id === v.foodId && (f.activeVersionId === v.id || v.id === row.foodVersionId)));
              const stockOptions = [
                ...(food ? [{ id: food.id, name: `${food.name} · 与营养资料相同身份` }] : []),
                ...state.inventory.filter(l => l.unit === row.inventoryUnit && !state.foodDefinitions.some(f => f.id === l.foodId))
                  .map(l => ({ id: l.foodId, name: `${l.name} · 已有库存` })),
                ...state.recipes.flatMap(r => r.ingredients.filter(i => i.unit === row.inventoryUnit && !state.foodDefinitions.some(f => f.id === i.foodId))
                  .map(i => ({ id: i.foodId, name: `${i.name} · 既有菜谱关联` }))),
              ];
              const unique = [...new Map(stockOptions.map(o => [o.id, o])).values()];
              let stockPreview = "";
              if (version) {
                try {
                  const portion = calculateFoodPortion(version, Number(row.quantity), row.unit);
                  const one = calculateFoodPortion(version, 1, row.inventoryUnit);
                  const amount = portion.factor / one.factor;
                  if (!Number.isFinite(amount) || amount < .0001 || amount > 1e9) throw new Error("库存扣减量过小或过大，请核对规格。");
                  stockPreview = `制作时扣减 ${Number(amount.toFixed(4))} ${foodUnitLabels[row.inventoryUnit]}。`;
                } catch (e) { stockPreview = String(e); }
              }
              return <section className="recipe-ingredient-editor" key={row.key}>
                <div className="card-heading compact">
                  <h3>原料 {index + 1}{food?.name || row.sourceName ? ` · ${food?.name ?? row.sourceName}` : ""}</h3>
                  <button type="button" className="icon-button" aria-label={`移除原料${index + 1}`} onClick={() => setRows(r => r.filter(v => v.key !== row.key))}><Trash2 size={16} /></button>
                </div>
                <label><span>食材与营养版本</span><select required value={row.foodVersionId} onChange={e => {
                  const v = state.foodDefinitionVersions.find(v => v.id === e.target.value);
                  if (!v) return;
                  const bases = [v.basis.unit, ...v.conversions.map(c => c.unit)];
                  const compatible = bases.includes(row.unit);
                  const base = (bases.find(u => ["g", "ml", "piece"].includes(u)) ?? "g") as InventoryLot["unit"];
                  patch(row.key, {
                    foodVersionId: v.id, quantity: compatible ? row.quantity : String(v.basis.quantity),
                    unit: compatible ? row.unit : v.basis.unit, inventoryFoodId: v.foodId, inventoryUnit: base,
                    notice: compatible ? undefined : `新食材不支持原来的“${foodUnitLabels[row.unit]}”，已改为参考规格 ${v.basis.quantity} ${foodUnitLabels[v.basis.unit]}；请重新核对数量，不是自动换算。`,
                  });
                }}>
                  <option value="">{row.sourceName ? `为“${row.sourceName}”选择已建档食物` : "选择已建档的单个食物"}</option>
                  {versions.map(v => {
                    const d = state.foodDefinitions.find(f => f.id === v.foodId)!;
                    return <option key={v.id} value={v.id}>{d.name} · {d.brand ?? "无品牌"} · {foodBasisLabels[d.measurementBasis]} · v{v.version}{d.activeVersionId !== v.id ? "（沿用历史版本）" : ""}</option>;
                  })}
                </select></label>
                {row.notice && <p className="recipe-unit-notice" role="status">{row.notice}</p>}
                <div className="form-grid">
                  <label><span>原料数量（整锅）</span><input required type="number" min="0" step="any" value={row.quantity} onChange={e => patch(row.key, { quantity: e.target.value })} /></label>
                  <label><span>营养计量单位</span><select value={row.unit} onChange={e => patch(row.key, { unit: e.target.value as FoodUnit, notice: undefined })}>{(version ? [version.basis.unit, ...version.conversions.map(c => c.unit)] : [row.unit]).map(u => <option key={u} value={u}>{foodUnitLabels[u]}</option>)}</select></label>
                </div>
                <div className="form-grid">
                  <label><span>库存扣减基础单位</span><select value={row.inventoryUnit} onChange={e => patch(row.key, { inventoryUnit: e.target.value as InventoryLot["unit"], inventoryFoodId: food?.id ?? "" })}>{(["g", "ml", "piece"] as const).map(u => <option key={u} value={u}>{foodUnitLabels[u]}</option>)}</select></label>
                  <label><span>关联库存食材身份</span><select required value={row.inventoryFoodId} onChange={e => patch(row.key, { inventoryFoodId: e.target.value })}>
                    <option value="">选择明确的库存身份</option>
                    {row.inventoryFoodId && !unique.some(o => o.id === row.inventoryFoodId) && <option value={row.inventoryFoodId}>原菜谱关联（请核对）</option>}
                    {unique.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select></label>
                </div>
                {stockPreview && <p className="form-hint recipe-stock-preview">{stockPreview}</p>}
                <label className="checkbox-label"><input type="checkbox" checked={row.inventoryConfirmed} onChange={e => patch(row.key, { inventoryConfirmed: e.target.checked })} /><span>已核对该项品牌、生熟状态、净量／可食部分与库存扣减量一致</span></label>
              </section>;
            })}
            <button type="button" className="button secondary" disabled={rows.length >= 50} onClick={() => setRows(r => [...r, emptyRow()])}><Plus size={16} /> 添加一种原料</button>
            <details className="recipe-rules">
              <summary>厨具与保存规则 · {equipment.length ? equipment.join("、") : "尚未选择厨具"}</summary>
              <div className="recipe-equipment"><span>实际厨具</span>{state.profile.equipment.map(eq => <label className="checkbox-label" key={eq}><input type="checkbox" checked={equipment.includes(eq)} onChange={e => setEquipment(items => e.target.checked ? [...items, eq] : items.filter(v => v !== eq))} /><span>{eq}</span></label>)}</div>
              <ul>
                <li>旧菜谱、旧营养版本和已制作批次保持不变。保存由 Rust 重新核算，任何一项营养缺失，整锅该项也保持未知。</li>
                <li>采购实收须关联相同库存身份；不按同名合并品牌，不默认互换克与毫升、生重与熟重。</li>
                <li>带骨、沥干、可食率和原料状态请人工核对。原菜谱没有食材营养关联时须逐项补全。</li>
              </ul>
            </details>
            {preview ? <div className="library-notice" role="status">整锅预览：{nutrientLabel(preview.nutrition, "calories")} kcal · 蛋白质 {nutrientLabel(preview.nutrition, "protein")} g · 纤维 {nutrientLabel(preview.nutrition, "fiber")} g。</div>
              : !missing && <p className="form-error" role="status">{error}</p>}
            {!equipment.length && <p className="form-error">请展开“厨具与保存规则”，选择实际厨具后再保存。</p>}
            {rows.some(r => !r.inventoryConfirmed) && !missing && <p className="form-hint">核对每项原料后，勾选对应确认项即可保存。</p>}
            {action.message && <p className="form-error" role="alert">{action.message}</p>}
            <button className="button primary wide" disabled={action.busy || !canSave}>{action.busy ? "正在保存…" : "确认保存菜谱版本（不制作）"}</button>
          </fieldset>
        </form>
      </Modal>
    </div>
    {libraryOpen && <FoodLibraryModal catalogOnly onClose={() => setLibraryOpen(false)} onManual={() => undefined} />}
  </>;
}
