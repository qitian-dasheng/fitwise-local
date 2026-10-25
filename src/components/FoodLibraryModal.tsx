import { diaryToday } from "../domain/diary";
import { Archive, ArchiveRestore, Check, PencilLine, Plus, Search, Star, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useFoodLibrarySearch, useFoodPortionPreview } from "../data/foodLibrary";
import { calculateFoodPortion, findFoodItem, foodBasisLabels, foodUnitLabels, nutrientLabel } from "../domain/foodLibrary";
import { missingNutrientKeys, summarizeMeals } from "../domain/calculations";
import { totalNutrient } from "../domain/nutritionDisplay";
import { nutrientKeys, type FoodLibraryItem, type FoodMealInput, type MealEntry, type FoodUnit, type NutritionFacts } from "../domain/types";
import { useAppStore } from "../store/appStore";
import { useFoodPicker } from "../store/foodPicker";
import { Modal } from "./Modal";
import { FoodEditor, FoodIdentityEditor, NutritionPreview } from "./FoodEditor";
import { useConfirmedAction } from "./useConfirmedAction";
import { useEnergyUnit } from "../hooks/useEnergyUnit";
import { energyUnitLabels } from "../domain/energyDisplay";

const mealLabels = { breakfast: "早餐", lunch: "午餐", dinner: "晚餐", snack: "加餐" };
const nutrientLabels = { calories: "能量", protein: "蛋白质", carbohydrates: "碳水化合物", fat: "脂肪", fiber: "膳食纤维", sugar: "糖", sodium: "钠" };
type BasketEntry = FoodMealInput["entries"][number] & { name: string; facts: NutritionFacts };

export function FoodLibraryModal({ onClose, onManual, initialType = "breakfast", initialDate = diaryToday(), onRecorded, catalogOnly = false, onOpenEditor, preselectFoodId }: { onClose: () => void; onManual: () => void; initialType?: FoodMealInput["type"]; initialDate?: string; onRecorded?: (date: string) => void; catalogOnly?: boolean; /** 记餐模式下由外部页面接管建档/修订（跳食材库页）；未提供时退回弹窗内嵌编辑器。 */ onOpenEditor?: (target: "new" | FoodLibraryItem) => void; /** 打开时自动选中的食物（从食材库页建档返回场景）。 */ preselectFoodId?: string }) {
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"all" | "recent" | "favorites" | "archived">("all");
  const [selected, setSelected] = useState<FoodLibraryItem | null>(null);
  const [quantity, setQuantity] = useState("100");
  const [unit, setUnit] = useState<FoodUnit>("g");
  const [type, setType] = useState(initialType);
  const [date, setDate] = useState(initialDate);
  // 篮子放跨页 store：从食材库页建档回来再打开选择器，篮子不丢。
  const basket = useFoodPicker((picker) => picker.basket);
  const setBasket = useFoodPicker((picker) => picker.setBasket);
  const [editingBasket, setEditingBasket] = useState<number | null>(null);
  const [editing, setEditing] = useState<FoodLibraryItem | "new" | null>(null);
  const [identity, setIdentity] = useState<FoodLibraryItem | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [displayUnit] = useEnergyUnit();
  const state = useAppStore();
  const search = useFoodLibrarySearch(query, mode);
  const action = useConfirmedAction();
  const request = selected && Number(quantity) > 0 && Number.isFinite(Number(quantity)) ? { foodVersionId: selected.version.id, quantity: Number(quantity), unit } : null;
  const preview = useFoodPortionPreview(request);
  // 批次合计与行内改量：直接复用日记同口径的计算函数，未知营养永不按 0 计入。
  const basketMealEntries: MealEntry[] = basket.map((entry, index) => ({ id: `basket-${index}`, date, type, name: entry.name, amountLabel: "", nutrition: entry.facts, consumedRatio: 1, source: "manual", confidence: "high", createdAt: "" }));
  const basketSummary = summarizeMeals(basketMealEntries);
  const basketMissing = missingNutrientKeys(basketMealEntries);
  function updateBasketQuantity(index: number, raw: string) {
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) return;
    const entry = basket[index];
    const version = state.foodDefinitionVersions.find((item) => item.id === entry.foodVersionId);
    if (!version) return;
    try {
      const facts = calculateFoodPortion(version, value, entry.unit).nutrition;
      setBasket((items) => items.map((item, itemIndex) => (itemIndex === index ? { ...item, quantity: value, facts } : item)));
    } catch { /* 换算失败保留原值，不静默写入错误营养 */ }
  }

  function choose(item: FoodLibraryItem) {
    setSelected(item); setQuantity(String(item.version.basis.quantity)); setUnit(item.version.basis.unit); action.setMessage("");
  }

  // 打开时：预选外部指定的新建食物（回程场景），并剔除篮子里已被修订失效的旧版本条目。
  useEffect(() => {
    if (preselectFoodId) {
      const item = findFoodItem(useAppStore.getState(), preselectFoodId);
      if (item) choose(item);
    }
    useFoodPicker.getState().setBasket((items) => items.filter((entry) => useAppStore.getState().foodDefinitionVersions.some((version) => version.id === entry.foodVersionId)));
  }, [preselectFoodId]);

  return <Modal title={editing ? editing === "new" ? "新建食物" : "修订营养规格" : identity ? "纠错名称 / 品牌" : catalogOnly ? "管理食材营养资料" : "从食材库记录饮食"} onClose={() => { if (!action.busy) onClose(); }}><div className="food-library">
    {editing ? <FoodEditor action={action} key={editing === "new" ? "new" : editing.version.id} item={editing === "new" ? undefined : editing} onCancel={() => { action.setMessage(""); setEditing(null); }} onSaved={(foodId) => {
      setEditing(null); setMode("all"); setQuery("");
      const item = findFoodItem(useAppStore.getState(), foodId);
      if (item) choose(item);
      const oldVersionIds = new Set(useAppStore.getState().foodDefinitionVersions.filter((version) => version.foodId === foodId).map((version) => version.id));
      setBasket((items) => items.filter((entry) => !oldVersionIds.has(entry.foodVersionId)));
      setNotice(catalogOnly ? "食物资料已保存。关闭本窗口返回菜谱，无须记餐。" : "食物资料已保存。填写吃了多少并确认后，才会记入饮食。");
    }} /> : identity ? <FoodIdentityEditor item={identity} action={action} onCancel={() => { action.setMessage(""); setIdentity(null); }} onSaved={() => { setIdentity(null); setNotice("名称/品牌已纠错。营养规格与历史记录未改动。"); }} /> : <fieldset className="library-fields" disabled={action.busy}>
      <p className="form-hint">首次确认规格，以后只填吃了多少。这里使用营养资料，记餐不会重复扣减制作批次的库存。</p>
      {notice && <p className="library-notice" role="status">{notice}</p>}
      <div className="library-toolbar"><label className="library-search"><Search size={17}/><input aria-label="搜索食物或品牌" placeholder="搜索食物名称或品牌" value={query} onChange={(event) => setQuery(event.target.value)}/></label><button className="button primary small" onClick={() => (onOpenEditor ? onOpenEditor("new") : setEditing("new"))}><Plus size={15}/> 新建食物</button></div>
      <div className="library-tabs" role="group" aria-label="食材筛选">{([["all", "全部"], ["recent", "最近使用"], ["favorites", "常用收藏"]] as const).map(([value, label]) => <button key={value} className={mode === value ? "active" : ""} onClick={() => setMode(value)}>{label}</button>)}{catalogOnly&&<button className={mode === "archived" ? "active" : ""} onClick={() => { setMode("archived"); setPendingDelete(null); }}>已归档</button>}{!catalogOnly&&<button onClick={onManual}>仅记录本次</button>}</div>
      {search.error && <p className="form-error" role="alert">{search.error}</p>}
      <div className="library-body"><div className="library-results">
        {search.loading ? <p className="form-hint">正在读取食材库…</p> : search.items.length ? search.items.map((item) => <div key={item.definition.id}>
          <div className={`library-item ${item.definition.id === selected?.definition.id ? "selected" : ""}`}>
            <button className="library-select" onClick={() => choose(item)}><strong>{item.definition.name}</strong><span>{item.definition.brand || "无品牌"} · {foodBasisLabels[item.definition.measurementBasis]}</span><small>每 {item.version.basis.quantity}{foodUnitLabels[item.version.basis.unit]} · {nutrientLabel(item.version.nutrition, "calories", 1, displayUnit)} {energyUnitLabels[displayUnit]} · v{item.version.version}</small></button>
            <button className={`icon-button ${item.definition.favorite ? "favorite" : ""}`} aria-label={`${item.definition.favorite ? "取消收藏" : "收藏"}${item.definition.name}`} disabled={action.busy} onClick={() => { void action.run(`favorite:${item.definition.id}:${!item.definition.favorite}`, (id) => state.setFoodFavorite(item.definition.id, !item.definition.favorite, id)); }}><Star size={17} fill={item.definition.favorite ? "currentColor" : "none"}/></button>
            {catalogOnly&&<>
              <button className={`icon-button ${item.definition.archived ? "favorite" : ""}`} aria-label={`${item.definition.archived ? "取消归档" : "归档"}${item.definition.name}`} title={item.definition.archived ? "取消归档后重新出现在日常挑选" : "归档后从日常挑选隐藏，历史记录不受影响"} disabled={action.busy} onClick={() => { const archived = item.definition.archived === true; void action.run(`archive:${item.definition.id}:${!archived}`, async (id) => { const result = await state.setFoodArchived(item.definition.id, !archived, id); if (!result.error) setNotice(archived ? `已取消归档「${item.definition.name}」。` : `已归档「${item.definition.name}」，日常挑选将不再显示。`); return result; }); }}>{item.definition.archived ? <ArchiveRestore size={16}/> : <Archive size={16}/>}</button>
              <button className="icon-button" aria-label={`纠错${item.definition.name}的名称或品牌`} title="纠错名称/品牌（未引用食材）" disabled={action.busy} onClick={() => { action.setMessage(""); setPendingDelete(null); setIdentity(item); }}><PencilLine size={16}/></button>
              <button className="icon-button" aria-label={`永久删除${item.definition.name}`} title="永久删除（仅无引用食材）" disabled={action.busy} onClick={() => { action.setMessage(""); setPendingDelete(item.definition.id); }}><Trash2 size={16}/></button>
            </>}
          </div>
          {catalogOnly&&pendingDelete === item.definition.id&&<div className="delete-confirm" role="alert">
            <strong>永久删除「{item.definition.name}」？</strong>
            <span>仅当没有任何餐食或菜谱引用时才允许删除。删除后可在导出 JSON 的审计记录中找到完整内容手工恢复，但没有一键恢复。</span>
            <div className="button-row">
              <button className="button danger small" disabled={action.busy} onClick={() => { void action.run(`delete:${item.definition.id}`, async (id) => { const result = await state.deleteFood(item.definition.id, id); if (!result.error) { setPendingDelete(null); setNotice(`已永久删除「${item.definition.name}」。`); } return result; }); }}>确认永久删除</button>
              <button className="button secondary small" disabled={action.busy} onClick={() => setPendingDelete(null)}>取消</button>
            </div>
          </div>}
        </div>) : <div className="library-empty"><strong>{mode === "recent" ? "尚无食材库记餐记录" : mode === "favorites" ? "还没有收藏食物" : mode === "archived" ? "没有已归档的食材" : "没有找到食物"}</strong><p>新食物先保存一次规格，之后就可以直接选择。</p><button className="button secondary small" onClick={() => (onOpenEditor ? onOpenEditor("new") : setEditing("new"))}>新建食物</button></div>}
      </div><div className="library-portion">{selected ? <>
        <div className="card-heading compact"><div><h3>{selected.definition.name}</h3><p className="form-hint">{selected.definition.brand} · {foodBasisLabels[selected.definition.measurementBasis]} · v{selected.version.version}</p></div><button className="text-button" onClick={() => (onOpenEditor ? onOpenEditor(selected) : setEditing(selected))}>修订规格</button></div>
        <p className="form-hint">参考：每 {selected.version.basis.quantity}{foodUnitLabels[selected.version.basis.unit]}；原始能量 {selected.version.labelNutrients.calories ?? "未知"} {selected.version.energyUnit}</p>
        {selected.version.origin?.method === "manual_label" && <p className="form-hint">来源：离线标签人工核对；原始规格和来源记录保存在收件箱“已建档”草稿中。</p>}
        {selected.per100g && <p className="form-hint">每 100 克：{nutrientLabel(selected.per100g, "calories", 1, displayUnit)} {energyUnitLabels[displayUnit]}，蛋白质 {nutrientLabel(selected.per100g, "protein")} g</p>}
        {selected.per100ml && <p className="form-hint">每 100 毫升：{nutrientLabel(selected.per100ml, "calories", 1, displayUnit)} {energyUnitLabels[displayUnit]}，蛋白质 {nutrientLabel(selected.per100ml, "protein")} g</p>}
        <div className="form-grid"><label><span>{catalogOnly ? "营养换算预览数量（不记餐）" : "实际吃了多少"}</span><input type="number" min="0" step="any" aria-label="摄入数量" value={quantity} onChange={(event) => setQuantity(event.target.value)}/></label><label><span>单位</span><select aria-label="摄入单位" value={unit} onChange={(event) => setUnit(event.target.value as FoodUnit)}>{[selected.version.basis.unit, ...selected.version.conversions.map((conversion) => conversion.unit)].map((value) => <option key={value} value={value}>{foodUnitLabels[value]}</option>)}</select></label></div>
        {preview.loading && <p className="form-hint">正在换算…</p>}{preview.error && <p className="form-error" role="alert">{preview.error}</p>}
        {preview.data && <><NutritionPreview facts={preview.data.nutrition} energyUnit={displayUnit}/>{!catalogOnly&&<button className="button secondary wide" disabled={action.busy || basket.length >= 50} onClick={() => { if (!request || !preview.data) return; const facts = preview.data.nutrition; setBasket((items) => [...items, { ...request, name: selected.definition.name, facts }]); setNotice(`已把 ${selected.definition.name} 加入待确认餐食，可继续选择其他食物。`); }}><Plus size={15}/> 加入本餐</button>}</>}
        <p className="form-hint">缺少“个／份／包装”换算时，先修订规格；生重、熟重及可食部分分别建档。</p>
      </> : <p className="form-hint">选择一个食物，查看营养和摄入量换算。</p>}</div></div>
      {!catalogOnly&&<div className="library-basket"><h3>本次待确认 · {basket.length} 项</h3>
        {basket.length > 0 && <div className="basket-summary" aria-label="本批营养合计">
          <strong>本批合计 · {basket.length} 项</strong>
          <div className="basket-summary-grid">{nutrientKeys.map((key) => {
            const display = totalNutrient(basketSummary, key, { entryCount: basket.length, missing: basketMissing.includes(key) }, displayUnit);
            const unit = key === "calories" ? energyUnitLabels[displayUnit] : key === "sodium" ? "mg" : "g";
            return <span key={key}>{nutrientLabels[key]} <b className={display.state === "unknown" ? "basket-unknown" : ""} title={display.title}>{display.text}</b>{display.state === "unknown" ? "" : ` ${unit}`}</span>;
          })}</div>
          <p className="form-hint">「未知」不按 0 计入；「≥」为已知项小计，仍有食物未提供该营养。</p>
        </div>}
        {basket.map((entry, index) => <div className="basket-row" key={index}><div><strong>{entry.name}</strong>
          {editingBasket === index
            ? <span className="basket-edit"><input type="number" min="0" step="any" aria-label={`修改${entry.name}的数量`} defaultValue={entry.quantity} onChange={(event) => updateBasketQuantity(index, event.target.value)} /><button className="icon-button" aria-label="完成修改" onClick={() => setEditingBasket(null)}><Check size={15}/></button></span>
            : <span>{entry.quantity}{foodUnitLabels[entry.unit]} · {nutrientLabel(entry.facts, "calories", 1, displayUnit)} {energyUnitLabels[displayUnit]}</span>}
        </div><span className="basket-actions">
          {editingBasket !== index && <button className="icon-button" aria-label={`修改${entry.name}数量`} disabled={action.busy} onClick={() => setEditingBasket(index)}><PencilLine size={15}/></button>}
          <button className="icon-button" aria-label={`移除${entry.name}`} disabled={action.busy} onClick={() => { setBasket((items) => items.filter((_, itemIndex) => itemIndex !== index)); if (editingBasket === index) setEditingBasket(null); }}><Trash2 size={16}/></button>
        </span></div>)}
        <div className="form-grid"><label><span>日期</span><input type="date" required max={diaryToday()} value={date} onChange={(event) => setDate(event.target.value)}/></label><label><span>餐次</span><select value={type} onChange={(event) => setType(event.target.value as FoodMealInput["type"])}>{Object.entries(mealLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
        {action.message && <p className="form-error" role="alert">{action.message}</p>}
        <button className="button primary wide" disabled={action.busy || !basket.length || !date || date > diaryToday()} onClick={async () => { const input: FoodMealInput = { date, type, entries: basket.map(({ foodVersionId, quantity, unit }) => ({ foodVersionId, quantity, unit })) }; const result = await action.run(JSON.stringify(input), (id) => state.recordFoodMeal(input, id)); if (!result.error) { useFoodPicker.getState().clearBasket(); onRecorded?.(date); onClose(); } }}>{action.busy ? "正在保存…" : `确认写入 ${basket.length} 项食物`}</button>
        <p className="form-hint">保存失败会保留本次待确认内容，可直接重试。若应用异常终止，重开后请先核对目标餐次再决定是否重记；万一重复，用条目「作废」移除并留痕。</p>
      </div>}
      {catalogOnly&&<p className="library-notice">这里只保存营养资料，不写入饮食；完成后关闭此窗口返回菜谱，原输入会保留。</p>}
    </fieldset>}
  </div></Modal>;
}

