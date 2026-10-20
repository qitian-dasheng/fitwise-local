import { diaryToday } from "../domain/diary";
import { ArrowLeft, Plus, Search, Star, Trash2 } from "lucide-react";
import { useState } from "react";
import { useFoodLibrarySearch, useFoodPortionPreview } from "../data/foodLibrary";
import { findFoodItem, foodBasisLabels, foodUnitLabels, nutrientLabel } from "../domain/foodLibrary";
import { nutrientKeys, type FoodDefinitionInput, type FoodLibraryItem, type FoodMealInput, type FoodMeasurementBasis, type FoodUnit, type NutritionFacts } from "../domain/types";
import { useAppStore } from "../store/appStore";
import { Modal } from "./Modal";
import { useConfirmedAction } from "./useConfirmedAction";

const mealLabels = { breakfast: "早餐", lunch: "午餐", dinner: "晚餐", snack: "加餐" };
const nutrientLabels = { calories: "能量", protein: "蛋白质", carbohydrates: "碳水化合物", fat: "脂肪", fiber: "膳食纤维", sugar: "糖", sodium: "钠" };
type BasketEntry = FoodMealInput["entries"][number] & { name: string; facts: NutritionFacts };

export function FoodLibraryModal({ onClose, onManual, initialType = "breakfast", initialDate = diaryToday(), onRecorded }: { onClose: () => void; onManual: () => void; initialType?: FoodMealInput["type"]; initialDate?: string; onRecorded?: (date: string) => void }) {
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"all" | "recent" | "favorites">("all");
  const [selected, setSelected] = useState<FoodLibraryItem | null>(null);
  const [quantity, setQuantity] = useState("100");
  const [unit, setUnit] = useState<FoodUnit>("g");
  const [type, setType] = useState(initialType);
  const [date, setDate] = useState(initialDate);
  const [basket, setBasket] = useState<BasketEntry[]>([]);
  const [editing, setEditing] = useState<FoodLibraryItem | "new" | null>(null);
  const [notice, setNotice] = useState("");
  const state = useAppStore();
  const search = useFoodLibrarySearch(query, mode);
  const action = useConfirmedAction();
  const request = selected && Number(quantity) > 0 && Number.isFinite(Number(quantity)) ? { foodVersionId: selected.version.id, quantity: Number(quantity), unit } : null;
  const preview = useFoodPortionPreview(request);

  function choose(item: FoodLibraryItem) {
    setSelected(item); setQuantity(String(item.version.basis.quantity)); setUnit(item.version.basis.unit); action.setMessage("");
  }

  return <Modal title={editing ? editing === "new" ? "新建食物" : "修订营养规格" : "从食材库记录饮食"} onClose={() => { if (!action.busy) onClose(); }}><div className="food-library">
    {editing ? <FoodEditor action={action} key={editing === "new" ? "new" : editing.version.id} item={editing === "new" ? undefined : editing} onCancel={() => { action.setMessage(""); setEditing(null); }} onSaved={(foodId) => {
      setEditing(null); setMode("all"); setQuery("");
      const item = findFoodItem(useAppStore.getState(), foodId);
      if (item) choose(item);
      const oldVersionIds = new Set(useAppStore.getState().foodDefinitionVersions.filter((version) => version.foodId === foodId).map((version) => version.id));
      setBasket((items) => items.filter((entry) => !oldVersionIds.has(entry.foodVersionId)));
      setNotice("食物资料已保存。填写吃了多少并确认后，才会记入饮食。");
    }} /> : <fieldset className="library-fields" disabled={action.busy}>
      <p className="form-hint">首次确认规格，以后只填吃了多少。这里使用营养资料，记餐不会重复扣减制作批次的库存。</p>
      {notice && <p className="library-notice" role="status">{notice}</p>}
      <div className="library-toolbar"><label className="library-search"><Search size={17}/><input aria-label="搜索食物或品牌" placeholder="搜索食物名称或品牌" value={query} onChange={(event) => setQuery(event.target.value)}/></label><button className="button primary small" onClick={() => setEditing("new")}><Plus size={15}/> 新建食物</button></div>
      <div className="library-tabs" role="group" aria-label="食材筛选">{([["all", "全部"], ["recent", "最近使用"], ["favorites", "常用收藏"]] as const).map(([value, label]) => <button key={value} className={mode === value ? "active" : ""} onClick={() => setMode(value)}>{label}</button>)}<button onClick={onManual}>仅记录本次</button></div>
      {search.error && <p className="form-error" role="alert">{search.error}</p>}
      <div className="library-body"><div className="library-results">
        {search.loading ? <p className="form-hint">正在读取食材库…</p> : search.items.length ? search.items.map((item) => <div className={`library-item ${item.definition.id === selected?.definition.id ? "selected" : ""}`} key={item.definition.id}>
          <button className="library-select" onClick={() => choose(item)}><strong>{item.definition.name}</strong><span>{item.definition.brand || "无品牌"} · {foodBasisLabels[item.definition.measurementBasis]}</span><small>每 {item.version.basis.quantity}{foodUnitLabels[item.version.basis.unit]} · {nutrientLabel(item.version.nutrition, "calories")} kcal · v{item.version.version}</small></button>
          <button className={`icon-button ${item.definition.favorite ? "favorite" : ""}`} aria-label={`${item.definition.favorite ? "取消收藏" : "收藏"}${item.definition.name}`} disabled={action.busy} onClick={() => { void action.run(`favorite:${item.definition.id}:${!item.definition.favorite}`, (id) => state.setFoodFavorite(item.definition.id, !item.definition.favorite, id)); }}><Star size={17} fill={item.definition.favorite ? "currentColor" : "none"}/></button>
        </div>) : <div className="library-empty"><strong>{mode === "recent" ? "尚无食材库记餐记录" : mode === "favorites" ? "还没有收藏食物" : "没有找到食物"}</strong><p>新食物先保存一次规格，之后就可以直接选择。</p><button className="button secondary small" onClick={() => setEditing("new")}>新建食物</button></div>}
      </div><div className="library-portion">{selected ? <>
        <div className="card-heading compact"><div><h3>{selected.definition.name}</h3><p className="form-hint">{selected.definition.brand} · {foodBasisLabels[selected.definition.measurementBasis]} · v{selected.version.version}</p></div><button className="text-button" onClick={() => setEditing(selected)}>修订规格</button></div>
        <p className="form-hint">参考：每 {selected.version.basis.quantity}{foodUnitLabels[selected.version.basis.unit]}；原始能量 {selected.version.labelNutrients.calories ?? "未知"} {selected.version.energyUnit}</p>
        {selected.per100g && <p className="form-hint">每 100 克：{nutrientLabel(selected.per100g, "calories")} kcal，蛋白质 {nutrientLabel(selected.per100g, "protein")} g</p>}
        {selected.per100ml && <p className="form-hint">每 100 毫升：{nutrientLabel(selected.per100ml, "calories")} kcal，蛋白质 {nutrientLabel(selected.per100ml, "protein")} g</p>}
        <div className="form-grid"><label><span>实际吃了多少</span><input type="number" min="0" step="any" aria-label="摄入数量" value={quantity} onChange={(event) => setQuantity(event.target.value)}/></label><label><span>单位</span><select aria-label="摄入单位" value={unit} onChange={(event) => setUnit(event.target.value as FoodUnit)}>{[selected.version.basis.unit, ...selected.version.conversions.map((conversion) => conversion.unit)].map((value) => <option key={value} value={value}>{foodUnitLabels[value]}</option>)}</select></label></div>
        {preview.loading && <p className="form-hint">正在换算…</p>}{preview.error && <p className="form-error" role="alert">{preview.error}</p>}
        {preview.data && <><NutritionPreview facts={preview.data.nutrition}/><button className="button secondary wide" disabled={action.busy || basket.length >= 50} onClick={() => { if (!request || !preview.data) return; const facts = preview.data.nutrition; setBasket((items) => [...items, { ...request, name: selected.definition.name, facts }]); setNotice(`已把 ${selected.definition.name} 加入待确认餐食，可继续选择其他食物。`); }}><Plus size={15}/> 加入本餐</button></>}
        <p className="form-hint">缺少“个／份／包装”换算时，先修订规格；生重、熟重及可食部分分别建档。</p>
      </> : <p className="form-hint">选择一个食物，查看营养和摄入量换算。</p>}</div></div>
      <div className="library-basket"><h3>本次待确认 · {basket.length} 项</h3>{basket.map((entry, index) => <div className="basket-row" key={index}><div><strong>{entry.name}</strong><span>{entry.quantity}{foodUnitLabels[entry.unit]} · {nutrientLabel(entry.facts, "calories")} kcal</span></div><button className="icon-button" aria-label={`移除${entry.name}`} onClick={() => setBasket((items) => items.filter((_, itemIndex) => itemIndex !== index))}><Trash2 size={16}/></button></div>)}
        <div className="form-grid"><label><span>日期</span><input type="date" required max={diaryToday()} value={date} onChange={(event) => setDate(event.target.value)}/></label><label><span>餐次</span><select value={type} onChange={(event) => setType(event.target.value as FoodMealInput["type"])}>{Object.entries(mealLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
        {action.message && <p className="form-error" role="alert">{action.message}</p>}
        <button className="button primary wide" disabled={action.busy || !basket.length || !date || date > diaryToday()} onClick={async () => { const input: FoodMealInput = { date, type, entries: basket.map(({ foodVersionId, quantity, unit }) => ({ foodVersionId, quantity, unit })) }; const result = await action.run(JSON.stringify(input), (id) => state.recordFoodMeal(input, id)); if (!result.error) { onRecorded?.(date); onClose(); } }}>{action.busy ? "正在保存…" : `确认写入 ${basket.length} 项食物`}</button>
      </div>
    </fieldset>}
  </div></Modal>;
}

function NutritionPreview({ facts }: { facts: NutritionFacts }) {
  return <div className="food-nutrition-preview" aria-label="本次营养换算">{nutrientKeys.map((key) => <div key={key}><span>{nutrientLabels[key]}</span><strong>{nutrientLabel(facts, key)}{facts[key].state === "unknown" ? "" : ` ${facts[key].unit}`}</strong></div>)}</div>;
}

function FoodEditor({ item, action, onSaved, onCancel }: { item?: FoodLibraryItem; action: ReturnType<typeof useConfirmedAction>; onSaved: (foodId: string) => void; onCancel: () => void }) {
  const [name, setName] = useState(item?.definition.name ?? "");
  const [brand, setBrand] = useState(item?.definition.brand ?? "");
  const [measurementBasis, setMeasurementBasis] = useState<FoodMeasurementBasis>(item?.definition.measurementBasis ?? "packaged");
  const [basisQuantity, setBasisQuantity] = useState(String(item?.version.basis.quantity ?? 100));
  const [basisUnit, setBasisUnit] = useState<FoodUnit>(item?.version.basis.unit ?? "g");
  const [energyUnit, setEnergyUnit] = useState<"kcal" | "kJ">(item?.version.energyUnit ?? "kcal");
  const [source, setSource] = useState<FoodDefinitionInput["source"]>(item?.version.source ?? "label");
  const [values, setValues] = useState<Record<string, string>>(Object.fromEntries(nutrientKeys.map((key) => [key, item?.version.labelNutrients[key] === undefined ? "" : String(item.version.labelNutrients[key])])));
  const [conversions, setConversions] = useState((item?.version.conversions ?? []).map((conversion) => ({ unit: conversion.unit, quantity: String(conversion.quantity), basisQuantity: String(conversion.basisQuantity) })));
  const [confirmed, setConfirmed] = useState(false);
  const save = useAppStore((state) => state.saveFoodDefinition);
  return <form className="form" onSubmit={async (event) => {
    event.preventDefault();
    const input: FoodDefinitionInput = { name, brand: brand || undefined, measurementBasis, basis: { quantity: Number(basisQuantity), unit: basisUnit }, energyUnit, nutrients: Object.fromEntries(nutrientKeys.filter((key) => values[key] !== "").map((key) => [key, Number(values[key])])), conversions: conversions.map((conversion) => ({ unit: conversion.unit, quantity: Number(conversion.quantity), basisQuantity: Number(conversion.basisQuantity) })), source };
    const result = await action.run(JSON.stringify(input), (id) => save(input, item?.definition.id, item?.version.id, id));
    if (!result.error && result.foodId) onSaved(result.foodId);
  }}>
    <fieldset className="library-fields" disabled={action.busy}>
    <button type="button" className="text-button" disabled={action.busy} onClick={onCancel}><ArrowLeft size={15}/> 返回食材库</button>
    <div className="form-grid"><label><span>食物名称</span><input required maxLength={120} disabled={!!item} value={name} onChange={(event) => setName(event.target.value)} placeholder="例如 原味燕麦片"/></label><label><span>品牌（可选）</span><input maxLength={120} disabled={!!item} value={brand} onChange={(event) => setBrand(event.target.value)} placeholder="不同品牌分别保存"/></label></div>
    <label><span>计量状态</span><select disabled={!!item} value={measurementBasis} onChange={(event) => setMeasurementBasis(event.target.value as FoodMeasurementBasis)}>{Object.entries(foodBasisLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    {item && <p className="form-hint">将保存为 v{item.version.version + 1}。历史餐食和旧版本保持不变；更换品牌或生熟状态请新建食物。</p>}
    <div className="form-grid"><label><span>标签参考数量</span><input required type="number" min="0" step="any" value={basisQuantity} onChange={(event) => setBasisQuantity(event.target.value)}/></label><label><span>参考单位</span><select value={basisUnit} onChange={(event) => { setBasisUnit(event.target.value as FoodUnit); setConversions([]); }}>{Object.entries(foodUnitLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
    <p className="library-notice">下面填写“每 {basisQuantity || "…"}{foodUnitLabels[basisUnit]}”的营养值。留空是未知，明确填 0 才是零。</p>
    <label><span>能量单位</span><select value={energyUnit} onChange={(event) => setEnergyUnit(event.target.value as "kcal" | "kJ")}><option value="kcal">千卡 kcal</option><option value="kJ">千焦 kJ（保存后自动换算千卡）</option></select></label>
    <div className="form-grid">{nutrientKeys.map((key) => <label key={key}><span>{nutrientLabels[key]}（{key === "calories" ? energyUnit : key === "sodium" ? "mg" : "g"}，可留空）</span><input type="number" min="0" step="any" value={values[key]} onChange={(event) => setValues({ ...values, [key]: event.target.value })}/></label>)}</div>
    <div className="library-conversions"><h3>可选：份量换算</h3><p className="form-hint">例如参考单位是克，填写“1 包装＝200 克”；参考单位是包装时，可填写“200 克＝1 包装”。仅填写已经核实的关系。</p>
      {conversions.map((conversion, index) => <div className="conversion-row" key={index}><input aria-label={`换算数量${index + 1}`} type="number" min="0" step="any" required value={conversion.quantity} onChange={(event) => setConversions((items) => items.map((item, row) => row === index ? { ...item, quantity: event.target.value } : item))}/><select aria-label={`换算单位${index + 1}`} value={conversion.unit} onChange={(event) => setConversions((items) => items.map((item, row) => row === index ? { ...item, unit: event.target.value as FoodUnit } : item))}>{Object.entries(foodUnitLabels).filter(([value]) => value !== basisUnit).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><span>＝</span><input aria-label={`对应数量${index + 1}`} type="number" min="0" step="any" required value={conversion.basisQuantity} onChange={(event) => setConversions((items) => items.map((item, row) => row === index ? { ...item, basisQuantity: event.target.value } : item))}/><span>{foodUnitLabels[basisUnit]}</span><button type="button" className="icon-button" aria-label="移除换算" onClick={() => setConversions((items) => items.filter((_, row) => row !== index))}><Trash2 size={15}/></button></div>)}
      <button type="button" className="button secondary small" disabled={conversions.length >= 4} onClick={() => { const next = (Object.keys(foodUnitLabels) as FoodUnit[]).find((unit) => unit !== basisUnit && !conversions.some((item) => item.unit === unit)); if (next) setConversions([...conversions, { unit: next, quantity: "1", basisQuantity: "" }]); }}>添加换算规格</button>
    </div>
    <label><span>数据来源</span><select value={source} onChange={(event) => setSource(event.target.value as FoodDefinitionInput["source"])}><option value="label">包装营养标签</option><option value="manual">手工填写</option><option value="official">官方资料人工核对</option><option value="personal">个人确认资料</option><option value="fatsecret">FatSecret 来源快照</option></select></label>
    <label className="checkbox-label"><input required type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)}/><span>我已核对参考数量、千焦／千卡和换算规格，确认保存这些资料。</span></label>
    {action.message && <p className="form-error" role="alert">{action.message}</p>}
    <button className="button primary wide" type="submit" disabled={action.busy || !confirmed}>{action.busy ? "正在保存…" : "保存资料，继续填写摄入量"}</button>
    </fieldset>
  </form>;
}
