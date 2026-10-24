import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Modal } from "./Modal";
import { FoodLibraryModal } from "./FoodLibraryModal";
import { useConfirmedAction } from "./useConfirmedAction";
import { useAppStore } from "../store/appStore";
import { foodBasisLabels, foodUnitLabels, nutrientLabel } from "../domain/foodLibrary";
import { previewRecipe } from "../domain/recipes";
import type { FoodUnit, RecipeInput, RecipeVersion } from "../domain/types";
import { useEnergyUnit } from "../hooks/useEnergyUnit";
import { energyUnitLabels } from "../domain/energyDisplay";

type Row = {
  key: string;
  foodVersionId: string;
  quantity: string;
  unit: FoodUnit;
  sourceName?: string;
  notice?: string;
};
const emptyRow = (): Row => ({
  key: crypto.randomUUID(), foodVersionId: "", quantity: "100", unit: "g",
});

export function RecipeEditor({ recipe, copyMode = false, onClose, onSaved }: {
  recipe?: RecipeVersion;
  copyMode?: boolean;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const state = useAppStore();
  const action = useConfirmedAction();
  const [displayUnit] = useEnergyUnit();
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [name, setName] = useState(copyMode && recipe ? `${recipe.name}（副本）` : recipe?.name ?? "");
  const [minutes, setMinutes] = useState(String(recipe?.totalMinutes ?? 30));
  const [equipment, setEquipment] = useState(recipe?.equipment ?? state.profile.equipment.slice(0, 1));
  const [rows, setRows] = useState<Row[]>(() => recipe ? recipe.ingredients.map(i => ({
    key: crypto.randomUUID(), foodVersionId: i.foodVersionId ?? "",
    quantity: String(i.nutritionQuantity ?? i.amount), unit: i.nutritionUnit ?? i.unit,
    sourceName: i.name,
  })) : [emptyRow()]);
  const patch = (key: string, changes: Partial<Row>) => setRows(current => current.map(r =>
    r.key === key ? { ...r, ...changes } : r));
  const input: RecipeInput = {
    ...(copyMode && recipe ? { copiedFromVersionId: recipe.id } : {}),
    name, totalMinutes: Number(minutes), equipment,
    ingredients: rows.map(({ foodVersionId, quantity, unit }) => ({
      foodVersionId, quantity: Number(quantity), unit,
    })),
    ...(recipe && !copyMode ? { recipeId: recipe.recipeId, expectedVersionId: recipe.id } : {}),
  };
  let preview: ReturnType<typeof previewRecipe> | undefined;
  let error = "";
  try { preview = previewRecipe(state, input); } catch (e) { error = String(e); }
  const missing = rows.filter(r => !state.foodDefinitionVersions.some(v => v.id === r.foodVersionId)).length;
  const catalogEmpty = !state.foodDefinitions.some(f => state.foodDefinitionVersions.some(v => v.id === f.activeVersionId));
  const canSave = !!name.trim() && name.length <= 120 && Number.isInteger(Number(minutes)) && Number(minutes) >= 1 && Number(minutes) <= 1440
    && !error && !!rows.length && !!equipment.length;
  const summary = copyMode
    ? "另存为独立菜谱，原配方不变；保存不记餐。"
    : recipe ? "保存为新版本，已有历史版本不变；保存不记餐。"
      : "保存为标准菜谱；实际进食时再记账。";

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
              // 新选原料不列归档食材；本行已选的历史版本即使所属食材已归档也保留可选。
              const versions = state.foodDefinitionVersions.filter(v => state.foodDefinitions.some(f =>
                f.id === v.foodId && ((f.activeVersionId === v.id && !f.archived) || v.id === row.foodVersionId)));
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
                  patch(row.key, {
                    foodVersionId: v.id, quantity: compatible ? row.quantity : String(v.basis.quantity),
                    unit: compatible ? row.unit : v.basis.unit,
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
              </section>;
            })}
            <button type="button" className="button secondary" disabled={rows.length >= 50} onClick={() => setRows(r => [...r, emptyRow()])}><Plus size={16} /> 添加一种原料</button>
            <details className="recipe-rules">
              <summary>厨具与保存规则 · {equipment.length ? equipment.join("、") : "尚未选择厨具"}</summary>
              <div className="recipe-equipment"><span>实际厨具</span>{state.profile.equipment.map(eq => <label className="checkbox-label" key={eq}><input type="checkbox" checked={equipment.includes(eq)} onChange={e => setEquipment(items => e.target.checked ? [...items, eq] : items.filter(v => v !== eq))} /><span>{eq}</span></label>)}</div>
              <ul>
                <li>旧菜谱、旧营养版本保持不变。保存由 Rust 重新核算，任何一项营养缺失，整锅该项也保持未知。</li>
                <li>带骨、沥干、可食率和原料状态请人工核对。原菜谱没有食材营养关联时须逐项补全。</li>
              </ul>
            </details>
            {preview ? <div className="library-notice" role="status">整锅预览：{nutrientLabel(preview.nutrition, "calories", 1, displayUnit)} {energyUnitLabels[displayUnit]} · 蛋白质 {nutrientLabel(preview.nutrition, "protein")} g · 纤维 {nutrientLabel(preview.nutrition, "fiber")} g。</div>
              : !missing && <p className="form-error" role="status">{error}</p>}
            {!equipment.length && <p className="form-error">请展开“厨具与保存规则”，选择实际厨具后再保存。</p>}
            {action.message && <p className="form-error" role="alert">{action.message}</p>}
            <button className="button primary wide" disabled={action.busy || !canSave}>{action.busy ? "正在保存…" : "确认保存菜谱版本（不制作）"}</button>
          </fieldset>
        </form>
      </Modal>
    </div>
    {libraryOpen && <FoodLibraryModal catalogOnly onClose={() => setLibraryOpen(false)} onManual={() => undefined} />}
  </>;
}
