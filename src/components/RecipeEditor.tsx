import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Modal } from "./Modal";
import { FoodLibraryModal } from "./FoodLibraryModal";
import { useConfirmedAction } from "./useConfirmedAction";
import { useAppStore } from "../store/appStore";
import { foodBasisLabels, foodUnitLabels, nutrientLabel } from "../domain/foodLibrary";
import { previewRecipe } from "../domain/recipes";
import type { FoodUnit, InventoryLot, RecipeInput, RecipeVersion } from "../domain/types";
type Row={key:string;foodVersionId:string;quantity:string;unit:FoodUnit;inventoryFoodId:string;inventoryUnit:InventoryLot["unit"];inventoryConfirmed:boolean};
const emptyRow=():Row=>({key:crypto.randomUUID(),foodVersionId:"",quantity:"100",unit:"g",inventoryFoodId:"",inventoryUnit:"g",inventoryConfirmed:false});

export function RecipeEditor({recipe,onClose,onSaved}:{recipe?:RecipeVersion;onClose:()=>void;onSaved:(id:string)=>void}){
  const state=useAppStore();const action=useConfirmedAction();const [libraryOpen,setLibraryOpen]=useState(false);
  const [name,setName]=useState(recipe?.name??"");const [minutes,setMinutes]=useState(String(recipe?.totalMinutes??30));
  const [equipment,setEquipment]=useState(recipe?.equipment??state.profile.equipment.slice(0,1));
  const [rows,setRows]=useState<Row[]>(()=>recipe?recipe.ingredients.map(i=>({key:crypto.randomUUID(),foodVersionId:i.foodVersionId??"",quantity:String(i.nutritionQuantity??i.amount),unit:i.nutritionUnit??i.unit,inventoryFoodId:i.foodId,inventoryUnit:i.unit,inventoryConfirmed:false})):[emptyRow()]);
  const patch=(key:string,changes:Partial<Row>)=>setRows(current=>current.map(r=>r.key===key?{...r,inventoryConfirmed:false,...changes}:r));
  const input:RecipeInput={name,totalMinutes:Number(minutes),equipment,ingredients:rows.map(({foodVersionId,quantity,unit,inventoryFoodId,inventoryUnit,inventoryConfirmed})=>({foodVersionId,quantity:Number(quantity),unit,inventoryFoodId,inventoryUnit,inventoryConfirmed})),...(recipe?{recipeId:recipe.recipeId,expectedVersionId:recipe.id}:{})};
  let preview:ReturnType<typeof previewRecipe>|undefined;let error="";try{preview=previewRecipe(state,input);}catch(e){error=String(e);}
  return <><div hidden={libraryOpen}><Modal title={recipe?`修订菜谱 · v${recipe.version+1}`:"新建标准菜谱"} onClose={()=>{if(!action.busy)onClose();}}><form className="form recipe-editor" onSubmit={async e=>{e.preventDefault();const result=await action.run(JSON.stringify(input),id=>state.saveRecipe(input,id));if(!result.error&&result.recipeVersionId){onSaved(result.recipeVersionId);onClose();}}}><fieldset className="library-fields" disabled={action.busy}>
    <p className="form-hint">从已确认的食材库选择原料，整锅营养由程序求和。保存只建立菜谱版本，不制作、不扣库存、不记进食。每项营养有缺失时，整锅对应营养也保持未知。</p>
    {recipe&&<p className="library-notice">历史菜谱及已制作批次保持原版本。旧菜谱若尚无食材营养关联，请逐项人工选择，不会按同名猜测。</p>}
    <button type="button" className="button secondary" onClick={()=>setLibraryOpen(true)}>管理／新建食材（保留菜谱输入）</button>
    {!state.foodDefinitions.length&&<p className="library-notice">食材库为空：可先点击上方按钮建档并核对规格，再返回菜谱；只保存资料，不记餐。</p>}
    <div className="form-grid"><label><span>菜谱名称</span><input required maxLength={120} value={name} onChange={e=>setName(e.target.value)}/></label><label><span>准备、烹饪与清洁总分钟</span><input required type="number" min="1" max="1440" step="1" value={minutes} onChange={e=>setMinutes(e.target.value)}/></label></div>
    <div className="recipe-equipment"><span>实际厨具</span>{state.profile.equipment.map(eq=><label className="checkbox-label" key={eq}><input type="checkbox" checked={equipment.includes(eq)} onChange={e=>setEquipment(items=>e.target.checked?[...items,eq]:items.filter(v=>v!==eq))}/><span>{eq}</span></label>)}</div>
    {rows.map((row,index)=>{
      const version=state.foodDefinitionVersions.find(v=>v.id===row.foodVersionId);const food=state.foodDefinitions.find(f=>f.id===version?.foodId);
      const versions=state.foodDefinitionVersions.filter(v=>state.foodDefinitions.some(f=>f.activeVersionId===v.id)||v.id===row.foodVersionId);
      const stockOptions=[...(food?[{id:food.id,name:`${food.name} · 与营养资料相同身份`}]:[]),...state.inventory.filter(l=>l.unit===row.inventoryUnit&&!state.foodDefinitions.some(f=>f.id===l.foodId)).map(l=>({id:l.foodId,name:`${l.name} · 已有库存`})),...state.recipes.flatMap(r=>r.ingredients.filter(i=>i.unit===row.inventoryUnit&&!state.foodDefinitions.some(f=>f.id===i.foodId)).map(i=>({id:i.foodId,name:`${i.name} · 既有菜谱关联`})) )];
      const unique=[...new Map(stockOptions.map(o=>[o.id,o])).values()];
      return <section className="recipe-ingredient-editor" key={row.key}><div className="card-heading compact"><h3>原料 {index+1}</h3><button type="button" className="icon-button" aria-label={`移除原料${index+1}`} onClick={()=>setRows(r=>r.filter(v=>v.key!==row.key))}><Trash2 size={16}/></button></div>
        <label><span>食材与营养版本</span><select required value={row.foodVersionId} onChange={e=>{const v=state.foodDefinitionVersions.find(v=>v.id===e.target.value);if(!v)return;const bases=[v.basis.unit,...v.conversions.map(c=>c.unit)];const base=(bases.find(u=>["g","ml","piece"].includes(u))??"g") as InventoryLot["unit"];patch(row.key,{foodVersionId:v.id,quantity:String(v.basis.quantity),unit:v.basis.unit,inventoryFoodId:v.foodId,inventoryUnit:base});}}><option value="">选择已建档的单个食物</option>{versions.map(v=>{const d=state.foodDefinitions.find(f=>f.id===v.foodId)!;return <option key={v.id} value={v.id}>{d.name} · {d.brand??"无品牌"} · {foodBasisLabels[d.measurementBasis]} · v{v.version}{d.activeVersionId!==v.id?"（沿用历史版本）":""}</option>;})}</select></label>
        <div className="form-grid"><label><span>原料数量（整锅）</span><input required type="number" min="0" step="any" value={row.quantity} onChange={e=>patch(row.key,{quantity:e.target.value})}/></label><label><span>营养计量单位</span><select value={row.unit} onChange={e=>patch(row.key,{unit:e.target.value as FoodUnit})}>{(version?[version.basis.unit,...version.conversions.map(c=>c.unit)]:[row.unit]).map(u=><option key={u} value={u}>{foodUnitLabels[u]}</option>)}</select></label></div>
        <div className="form-grid"><label><span>库存扣减基础单位</span><select value={row.inventoryUnit} onChange={e=>patch(row.key,{inventoryUnit:e.target.value as InventoryLot["unit"],inventoryFoodId:food?.id??""})}>{(["g","ml","piece"] as const).map(u=><option key={u} value={u}>{foodUnitLabels[u]}</option>)}</select></label><label><span>关联库存食材身份</span><select required value={row.inventoryFoodId} onChange={e=>patch(row.key,{inventoryFoodId:e.target.value})}><option value="">选择明确的库存身份</option>{row.inventoryFoodId&&!unique.some(o=>o.id===row.inventoryFoodId)&&<option value={row.inventoryFoodId}>原菜谱关联（请核对）</option>}{unique.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select></label></div>
        <p className="form-hint">{preview?`制作时扣减 ${preview.portions[index].amount} ${foodUnitLabels[row.inventoryUnit]}。`:"缺少单位换算时先修订食材规格；不能猜测克与毫升、生重与熟重。"}采购实收时须关联同一食材身份。带骨、沥干及可食率不能默认全部可食。</p>
        <label className="checkbox-label"><input type="checkbox" checked={row.inventoryConfirmed} onChange={e=>patch(row.key,{inventoryConfirmed:e.target.checked})}/><span>已核对该项品牌、生熟状态、净量／可食部分与库存扣减量一致</span></label>
      </section>;
    })}
    <button type="button" className="button secondary" disabled={rows.length>=50} onClick={()=>setRows(r=>[...r,emptyRow()])}><Plus size={16}/> 添加一种原料</button>
    {preview?<div className="library-notice" role="status">整锅预览：{nutrientLabel(preview.nutrition,"calories")} kcal · 蛋白质 {nutrientLabel(preview.nutrition,"protein")} g · 纤维 {nutrientLabel(preview.nutrition,"fiber")} g。保存时由 Rust 重新计算。</div>:<p className="form-hint">{error}</p>}
    {action.message&&<p className="form-error" role="alert">{action.message}</p>}<button className="button primary wide" disabled={action.busy||!!error||!rows.length||rows.some(r=>!r.inventoryConfirmed)||!equipment.length}>{action.busy?"正在保存…":"确认保存菜谱版本（不制作）"}</button>
  </fieldset></form></Modal></div>{libraryOpen&&<FoodLibraryModal catalogOnly onClose={()=>setLibraryOpen(false)} onManual={()=>undefined}/>}</>;
}
