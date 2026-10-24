import { useState } from "react";
import { Modal } from "./Modal";
import { useConfirmedAction } from "./useConfirmedAction";
import { useAppStore } from "../store/appStore";
import { diaryToday } from "../domain/diary";
import { calculateFoodPortion, foodUnitLabels, normalizeAmountLabel, nutrientLabel } from "../domain/foodLibrary";
import { nutrientKeys, type FoodUnit, type MealCorrectionInput, type MealEntry, type MealType } from "../domain/types";
const labels = { calories: "热量 kcal", protein: "蛋白质 g", fat: "脂肪 g", carbohydrates: "碳水化合物 g", fiber: "膳食纤维 g", sugar: "糖 g", sodium: "钠 mg" };
const mealTypeLabels: Record<MealType, string> = { breakfast: "早餐", lunch: "午餐", dinner: "晚餐", snack: "加餐" };

export function MealCorrectionModal({ meal, mode = "edit", onClose, onSaved }: { meal: MealEntry; mode?: "edit" | "void"; onClose: () => void; onSaved?: (date: string) => void }) {
  const action=useConfirmedAction();const correct=useAppStore(s=>s.correctMeal);
  const [voided,setVoided]=useState(mode==="void");const [reason,setReason]=useState("");const [confirmed,setConfirmed]=useState(false);
  const [date,setDate]=useState(meal.date);const [type,setType]=useState(meal.type);
  const [name,setName]=useState(meal.name);const [amount,setAmount]=useState(meal.amountLabel);
  const [quantity,setQuantity]=useState(String(meal.foodSnapshot?.quantity??1));const [unit,setUnit]=useState<FoodUnit>(meal.foodSnapshot?.unit??"g");
  const [values,setValues]=useState<Record<string,string>>(Object.fromEntries(nutrientKeys.map(k=>[k,meal.nutrition[k].state==="unknown"?"":String(meal.nutrition[k].value)])));
  let preview="";
  if(meal.foodSnapshot){try{const facts=calculateFoodPortion(meal.foodSnapshot.version,Number(quantity),unit).nutrition;preview=`本次换算：${nutrientLabel(facts,"calories")} kcal · 蛋白质 ${nutrientLabel(facts,"protein")} g（沿用原 v${meal.foodSnapshot.version.version}）`;}catch(e){preview=String(e);}}
  const diffRows:{label:string;from:string;to:string}[]=[];
  if(!voided){
    diffRows.push({label:"进食日期",from:meal.date,to:date});
    diffRows.push({label:"餐次",from:mealTypeLabels[meal.type],to:mealTypeLabels[type]});
    if(meal.foodSnapshot)diffRows.push({label:"摄入数量",from:`${meal.foodSnapshot.quantity} ${foodUnitLabels[meal.foodSnapshot.unit]}`,to:`${quantity} ${foodUnitLabels[unit]}`});
    if(!meal.foodSnapshot&&!meal.foodVersionId)diffRows.push({label:"食物 / 份量",from:`${meal.name} · ${normalizeAmountLabel(meal.amountLabel)}`,to:`${name} · ${amount}`});
  }
  return <Modal title={voided?"作废餐食记录":"更正餐食记录"} onClose={()=>{if(!action.busy)onClose();}}><form className="form" onSubmit={async e=>{
    e.preventDefault();const input:MealCorrectionInput={mealId:meal.id,reason,...(!voided?{date,type}:{}),...(!voided&&meal.foodSnapshot?{quantity:Number(quantity),unit}:{}),...(!voided&&!meal.foodVersionId?{name,amountLabel:amount,nutrients:Object.fromEntries(nutrientKeys.filter(k=>values[k]!=="").map(k=>[k,Number(values[k])]))}:{})};
    const result=await action.run(JSON.stringify({voided,input}),id=>correct(input,voided,id));if(!result.error){onSaved?.(result.date??date);onClose();}
  }}><fieldset className="library-fields" disabled={action.busy}>
    <div className="ratio-summary"><div><strong>{meal.name}</strong><span>原记录：{meal.date} · {normalizeAmountLabel(meal.amountLabel)} · 来源 {meal.source}{meal.foodVersionId?` · ${meal.foodVersionId}`:""}</span></div></div>
    <p className="form-hint">保留原始营养与来源，保存修订或作废原因；不硬删除。受影响日期需重新确认饮食完整。</p>
    <label className="checkbox-label"><input type="checkbox" checked={voided} onChange={e=>{setVoided(e.target.checked);setConfirmed(false);}}/><span>作废此条记录（不计入摄入，不可一键撤销）</span></label>
    {voided&&<p className="library-notice">作废只把这条进食移出有效汇总：不删除食材库、不返还生鲜、不撤销已记录的浪费，也不能一键恢复。原始记录与原因会保留在修订历史。</p>}
    {!voided&&<dl className="correction-diff">{diffRows.map(row=><div key={row.label} className={row.from!==row.to?"changed":""}><dt>{row.label}</dt><dd><s>{row.from}</s> → <b>{row.to}</b></dd></div>)}</dl>}
    {!voided&&<><div className="form-grid"><label><span>进食日期</span><input type="date" required max={diaryToday()} value={date} onChange={e=>setDate(e.target.value)}/></label><label><span>餐次</span><select value={type} onChange={e=>setType(e.target.value as MealType)}>{Object.entries(mealTypeLabels).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label></div>
    {meal.foodSnapshot?<><div className="form-grid"><label><span>正确的摄入数量</span><input type="number" required min="0" step="any" value={quantity} onChange={e=>setQuantity(e.target.value)}/></label><label><span>摄入单位</span><select value={unit} onChange={e=>setUnit(e.target.value as FoodUnit)}>{[meal.foodSnapshot.version.basis.unit,...meal.foodSnapshot.version.conversions.map(c=>c.unit)].map(u=><option key={u} value={u}>{foodUnitLabels[u]}</option>)}</select></label></div><p className="library-notice">{preview}</p><p className="form-hint">只更正数量，不套用食材库的新营养版本。食物或品牌选错时请作废后重新选择。</p></>:<><label><span>食物名称</span><input required maxLength={160} value={name} onChange={e=>setName(e.target.value)}/></label><label><span>份量说明</span><input required maxLength={300} value={amount} onChange={e=>setAmount(e.target.value)}/></label><div className="form-grid">{nutrientKeys.map(k=><label key={k}><span>{labels[k]}（留空未知）</span><input type="number" min="0" step="any" value={values[k]} onChange={e=>setValues(v=>({...v,[k]:e.target.value}))}/></label>)}</div></>}
    </>}
    <label><span>修改／作废原因</span><textarea required maxLength={500} value={reason} onChange={e=>setReason(e.target.value)} placeholder="例如 50 克误记为 500 克，或选错日期"/></label>
    <label className="checkbox-label"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/><span>我已核对修改及其对日记和熟食余量的影响</span></label>
    {action.message&&<p className="form-error" role="alert">{action.message}</p>}<button className={`button ${voided?"danger":"primary"} wide`} disabled={action.busy||!confirmed||!reason.trim()}>{action.busy?"正在保存…":voided?"确认作废并保留原记录":"确认更正并保留旧版本"}</button>
  </fieldset></form></Modal>;
}
