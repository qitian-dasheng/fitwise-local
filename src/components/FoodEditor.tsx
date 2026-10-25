import { ArrowLeft, Trash2 } from "lucide-react";
import { useState } from "react";
import { foodBasisLabels, foodUnitLabels, nutrientLabel } from "../domain/foodLibrary";
import { energyUnitLabels } from "../domain/energyDisplay";
import { nutrientKeys, type FoodDefinitionInput, type FoodLibraryItem, type FoodUnit, type NutritionFacts } from "../domain/types";
import { useAppStore } from "../store/appStore";
import type { useConfirmedAction } from "./useConfirmedAction";

const nutrientLabels = { calories: "能量", protein: "蛋白质", carbohydrates: "碳水化合物", fat: "脂肪", fiber: "膳食纤维", sugar: "糖", sodium: "钠" };

export function NutritionPreview({ facts, energyUnit = "kcal" }: { facts: NutritionFacts; energyUnit?: "kcal" | "kJ" }) {
  return <div className="food-nutrition-preview" aria-label="本次营养换算">{nutrientKeys.map((key) => <div key={key}><span>{nutrientLabels[key]}</span><strong>{nutrientLabel(facts, key, 1, energyUnit)}{facts[key].state === "unknown" ? "" : ` ${key === "calories" ? energyUnitLabels[energyUnit] : facts[key].unit}`}</strong></div>)}</div>;
}

/** 未引用食材的名称/品牌纠错：生熟状态只读，历史版本口径不被改写。 */
export function FoodIdentityEditor({ item, action, onSaved, onCancel }: { item: FoodLibraryItem; action: ReturnType<typeof useConfirmedAction>; onSaved: () => void; onCancel: () => void }) {
  const correctFoodIdentity = useAppStore((state) => state.correctFoodIdentity);
  const [name, setName] = useState(item.definition.name);
  const [brand, setBrand] = useState(item.definition.brand ?? "");
  return (
    <form className="form" onSubmit={async (event) => {
      event.preventDefault();
      const result = await action.run(
        JSON.stringify({ foodId: item.definition.id, name, brand }),
        (id) => correctFoodIdentity({ foodId: item.definition.id, name, brand: brand || undefined, measurementBasis: item.definition.measurementBasis }, id),
      );
      if (!result.error) onSaved();
    }}>
      <fieldset className="library-fields" disabled={action.busy}>
        <p className="form-hint">只更正名称与品牌；营养规格、历史记录与菜谱快照都不改动。若该食材已被餐食或菜谱引用，请改用「新建正确食材 + 归档旧项」。</p>
        <label><span>食物名称</span><input required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label><span>品牌（可留空）</span><input maxLength={120} value={brand} onChange={(event) => setBrand(event.target.value)} /></label>
        <p className="form-hint">生熟状态：{foodBasisLabels[item.definition.measurementBasis]}（暂不支持原地更改——更改生熟状态会改写历史版本的证明口径，请新建正确食材并归档旧项）。</p>
        {action.message && <p className="form-error" role="alert">{action.message}</p>}
        <div className="button-row">
          <button className="button primary small" type="submit" disabled={action.busy || !name.trim()}>保存纠错</button>
          <button type="button" className="button secondary small" disabled={action.busy} onClick={onCancel}>取消</button>
        </div>
      </fieldset>
    </form>
  );
}

/**
 * 新建/修订营养规格。同一份表单两种容器：
 * - modal：弹窗内嵌（菜谱上下文仍在用）；
 * - page：食材库独立页的全页两栏布局，能量单位与来源并排（OBS-003），营养表独立成栏。
 */
export function FoodEditor({ item, action, onSaved, onCancel, layout = "modal" }: { item?: FoodLibraryItem; action: ReturnType<typeof useConfirmedAction>; onSaved: (foodId: string) => void; onCancel: () => void; layout?: "modal" | "page" }) {
  const [name, setName] = useState(item?.definition.name ?? "");
  const [brand, setBrand] = useState(item?.definition.brand ?? "");
  const [measurementBasis, setMeasurementBasis] = useState<FoodDefinitionInput["measurementBasis"]>(item?.definition.measurementBasis ?? "packaged");
  const [basisQuantity, setBasisQuantity] = useState(String(item?.version.basis.quantity ?? 100));
  const [basisUnit, setBasisUnit] = useState<FoodUnit>(item?.version.basis.unit ?? "g");
  const [energyUnit, setEnergyUnit] = useState<"kcal" | "kJ">(item?.version.energyUnit ?? "kcal");
  const [source, setSource] = useState<FoodDefinitionInput["source"]>(item?.version.source ?? "label");
  const [values, setValues] = useState<Record<string, string>>(Object.fromEntries(nutrientKeys.map((key) => [key, item?.version.labelNutrients[key] === undefined ? "" : String(item.version.labelNutrients[key])])));
  const [conversions, setConversions] = useState((item?.version.conversions ?? []).map((conversion) => ({ unit: conversion.unit, quantity: String(conversion.quantity), basisQuantity: String(conversion.basisQuantity) })));
  const [confirmed, setConfirmed] = useState(false);
  const save = useAppStore((state) => state.saveFoodDefinition);
  const nutrientFields = (
    <div className="form-grid nutrient-grid">{nutrientKeys.map((key) => <label key={key}><span>{nutrientLabels[key]}（{key === "calories" ? energyUnit : key === "sodium" ? "mg" : "g"}，可留空）</span><input type="number" min="0" step="any" value={values[key]} onChange={(event) => setValues({ ...values, [key]: event.target.value })}/></label>)}</div>
  );
  const conversionFields = (
    <div className="library-conversions"><h3>可选：份量换算</h3><p className="form-hint">例如参考单位是克，填写“1 包装＝200 克”；参考单位是包装时，可填写“200 克＝1 包装”。仅填写已经核实的关系。</p>
      {conversions.map((conversion, index) => <div className="conversion-row" key={index}><input aria-label={`换算数量${index + 1}`} type="number" min="0" step="any" required value={conversion.quantity} onChange={(event) => setConversions((items) => items.map((item, row) => row === index ? { ...item, quantity: event.target.value } : item))}/><select aria-label={`换算单位${index + 1}`} value={conversion.unit} onChange={(event) => setConversions((items) => items.map((item, row) => row === index ? { ...item, unit: event.target.value as FoodUnit } : item))}>{Object.entries(foodUnitLabels).filter(([value]) => value !== basisUnit).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><span>＝</span><input aria-label={`对应数量${index + 1}`} type="number" min="0" step="any" required value={conversion.basisQuantity} onChange={(event) => setConversions((items) => items.map((item, row) => row === index ? { ...item, basisQuantity: event.target.value } : item))}/><span>{foodUnitLabels[basisUnit]}</span><button type="button" className="icon-button" aria-label="移除换算" onClick={() => setConversions((items) => items.filter((_, row) => row !== index))}><Trash2 size={15}/></button></div>)}
      <button type="button" className="button secondary small" disabled={conversions.length >= 4} onClick={() => { const next = (Object.keys(foodUnitLabels) as FoodUnit[]).find((unit) => unit !== basisUnit && !conversions.some((item) => item.unit === unit)); if (next) setConversions([...conversions, { unit: next, quantity: "1", basisQuantity: "" }]); }}>添加换算规格</button>
    </div>
  );
  const submitInput = (): FoodDefinitionInput => ({ name, brand: brand || undefined, measurementBasis, basis: { quantity: Number(basisQuantity), unit: basisUnit }, energyUnit, nutrients: Object.fromEntries(nutrientKeys.filter((key) => values[key] !== "").map((key) => [key, Number(values[key])])), conversions: conversions.map((conversion) => ({ unit: conversion.unit, quantity: Number(conversion.quantity), basisQuantity: Number(conversion.basisQuantity) })), source });
  const identityFields = (
    <>
      <div className="form-grid"><label><span>食物名称</span><input required maxLength={120} disabled={!!item} value={name} onChange={(event) => setName(event.target.value)} placeholder="例如 原味燕麦片"/></label><label><span>品牌（可选）</span><input maxLength={120} disabled={!!item} value={brand} onChange={(event) => setBrand(event.target.value)} placeholder="不同品牌分别保存"/></label></div>
      <label><span>食物状态</span><select disabled={!!item} value={measurementBasis} onChange={(event) => setMeasurementBasis(event.target.value as FoodDefinitionInput["measurementBasis"])}>{Object.entries(foodBasisLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      {item && <p className="form-hint">将保存为 v{item.version.version + 1}。历史餐食和旧版本保持不变；更换品牌或生熟状态请新建食物。</p>}
      <div className="form-grid"><label><span>标签参考数量</span><input required type="number" min="0" step="any" value={basisQuantity} onChange={(event) => setBasisQuantity(event.target.value)}/></label><label><span>参考单位</span><select value={basisUnit} onChange={(event) => { setBasisUnit(event.target.value as FoodUnit); setConversions([]); }}>{Object.entries(foodUnitLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
    </>
  );
  const confirmRow = (
    <>
      <label className="checkbox-label"><input required type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)}/><span>我已核对参考数量、千焦／千卡和换算规格，确认保存这些资料。</span></label>
      {action.message && <p className="form-error" role="alert">{action.message}</p>}
    </>
  );
  return <form className="form" onSubmit={async (event) => {
    event.preventDefault();
    const result = await action.run(JSON.stringify(submitInput()), (id) => save(submitInput(), item?.definition.id, item?.version.id, id));
    if (!result.error && result.foodId) onSaved(result.foodId);
  }}>
    <fieldset className="library-fields" disabled={action.busy}>
    {layout === "modal" && <button type="button" className="text-button" disabled={action.busy} onClick={onCancel}><ArrowLeft size={15}/> 返回食材库</button>}
    {layout === "page" ? (
      <>
        <div className="editor-columns">
          <div className="editor-col">
            {identityFields}
            <p className="library-notice">右栏填写“每 {basisQuantity || "…"}{foodUnitLabels[basisUnit]}”的营养值。留空是未知，明确填 0 才是零。</p>
            <div className="form-grid"><label><span>能量单位</span><select value={energyUnit} onChange={(event) => setEnergyUnit(event.target.value as "kcal" | "kJ")}><option value="kcal">千卡 kcal</option><option value="kJ">千焦 kJ（保存后自动换算千卡）</option></select></label><label><span>数据来源</span><select value={source} onChange={(event) => setSource(event.target.value as FoodDefinitionInput["source"])}><option value="label">包装营养标签</option><option value="manual">手工填写</option><option value="official">官方资料人工核对</option><option value="personal">个人确认资料</option><option value="fatsecret">FatSecret 来源快照</option></select></label></div>
          </div>
          <div className="editor-col">
            {nutrientFields}
            {conversionFields}
          </div>
        </div>
        <div className="editor-footer">
          {confirmRow}
          <button className="button primary" type="submit" disabled={action.busy || !confirmed}>{action.busy ? "正在保存…" : "保存营养资料"}</button>
          {!confirmed && !action.busy && <p className="form-hint">勾选左侧确认框后即可保存；无论表单多长，这一条始终停在页面底部。</p>}
        </div>
      </>
    ) : (
      <>
        {identityFields}
        <p className="library-notice">下面填写“每 {basisQuantity || "…"}{foodUnitLabels[basisUnit]}”的营养值。留空是未知，明确填 0 才是零。</p>
        <label><span>能量单位</span><select value={energyUnit} onChange={(event) => setEnergyUnit(event.target.value as "kcal" | "kJ")}><option value="kcal">千卡 kcal</option><option value="kJ">千焦 kJ（保存后自动换算千卡）</option></select></label>
        {nutrientFields}
        {conversionFields}
        <label><span>数据来源</span><select value={source} onChange={(event) => setSource(event.target.value as FoodDefinitionInput["source"])}><option value="label">包装营养标签</option><option value="manual">手工填写</option><option value="official">官方资料人工核对</option><option value="personal">个人确认资料</option><option value="fatsecret">FatSecret 来源快照</option></select></label>
        {confirmRow}
        <button className="button primary wide" type="submit" disabled={action.busy || !confirmed}>{action.busy ? "正在保存…" : "保存资料，继续填写摄入量"}</button>
      </>
    )}
    </fieldset>
  </form>;
}
