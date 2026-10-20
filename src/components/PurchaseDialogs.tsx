import { useState, type ReactNode } from "react";
import { useAppStore, type ActionResult } from "../store/appStore";
import { Modal } from "./Modal";
import { useConfirmedAction } from "./useConfirmedAction";
import type { InventoryLot, PurchaseDraft, PurchasePackaging, PurchaseUnit, ReceivePurchaseInput } from "../domain/types";
import { displayOrderedAt, localShanghaiInput, normalizePurchase, outstandingQuantity, platformLabels, purchaseSpecification, purchaseUnitLabels, quantityText, shanghaiDate, suggestedReceiptCost } from "../domain/purchases";
import { foodBasisLabels } from "../domain/foodLibrary";

function TransactionDialog({title,onClose,data,onConfirm,children,confirmLabel}:{title:string;onClose:()=>void;data:unknown;onConfirm:(id:string)=>Promise<ActionResult>;children:ReactNode;confirmLabel:string}) {
  const action=useConfirmedAction();
  return <Modal title={title} onClose={()=>{if(!action.busy)onClose();}}><form className="form inventory-form" onSubmit={async(event)=>{event.preventDefault();const result=await action.run(JSON.stringify(data),onConfirm);if(!result.error)onClose();}}><fieldset className="operation-fields" disabled={action.busy}>{children}{action.message&&<p role="alert" className="form-error">{action.message}</p>}<button className="button primary wide" type="submit" disabled={action.busy}>{action.busy?"正在保存…":confirmLabel}</button></fieldset></form></Modal>;
}
export function FoodLinkSelect({value,onChange,unit}:{value:string;onChange:(id:string)=>void;unit?:string}) {
  const state=useAppStore();
  const options=[...state.inventory.map(v=>({id:v.foodId,name:v.name,unit:v.unit})),...state.recipes.flatMap(r=>r.ingredients.map(v=>({id:v.foodId,name:`${v.name}（菜谱原料）`,unit:v.unit}))),...state.foodDefinitions.flatMap(d=>{const v=state.foodDefinitionVersions.find(v=>v.id===d.activeVersionId);if(!v)return[];return [v.basis.unit,...v.conversions.map(c=>c.unit)].filter(u=>["g","ml","piece"].includes(u)).map(u=>({id:d.id,name:`${d.name} · ${d.brand??"无品牌"} · ${foodBasisLabels[d.measurementBasis]}`,unit:u}));})];
  const unique=[...new Map(options.filter(o=>!unit||o.unit===unit).map(o=>[`${o.id}:${o.unit}`,o])).values()];
  return <label><span>关联食材（手动核对品牌、生熟和单位）</span><select value={value} onChange={e=>onChange(e.target.value)}><option value="">新建独立采购食材，不按同名自动合并</option>{value&&!unique.some(o=>o.id===value)&&<option value={value}>当前订单的独立食材（保持关联）</option>}{unique.map(o=><option key={`${o.id}:${o.unit}`} value={o.id}>{o.name} · {purchaseUnitLabels[o.unit as PurchaseUnit]}</option>)}</select></label>;
}
export function PurchaseModal({item,onClose}:{item?:PurchaseDraft;onClose:()=>void}) {
  const save=useAppStore(s=>s.addPurchase);const revise=useAppStore(s=>s.revisePurchase);
  const [name,setName]=useState(item?.name??"");const [foodId,setFoodId]=useState(item?.foodId??"");
  const [platform,setPlatform]=useState(item?.platform??"pinduoduo");const [platformName,setPlatformName]=useState(item?.platformName??"");
  const [orderedAt,setOrderedAt]=useState(item?.orderedAt?localShanghaiInput(item.orderedAt):item?"":localShanghaiInput());
  const [expected,setExpected]=useState(item?.expectedArrival??shanghaiDate(new Date(Date.now()+2*864e5).toISOString()));
  const [amount,setAmount]=useState(String(item?.amount??1));const [unit,setUnit]=useState<PurchaseUnit>(item?.unit??"pack");
  const [contentAmount,setContentAmount]=useState(String(item?.packaging?.contentAmount??""));const [contentUnit,setContentUnit]=useState<PurchasePackaging["contentUnit"]>(item?.packaging?.contentUnit??"kg");
  const [count,setCount]=useState(String(item?.packaging?.count??1));const [container,setContainer]=useState<PurchasePackaging["container"]>(item?.packaging?.container??"bag");
  const [withPieceSpec,setWithPieceSpec]=useState(!!item?.packaging);const [confirmed,setConfirmed]=useState(false);
  const [price,setPrice]=useState(String(item?.priceCny??""));const [paidMode,setPaidMode]=useState(item?.paidCny===undefined?"unknown":item.paidCny===0?"later":item.paidCny===item.priceCny?"paid":"partial");
  const [paid,setPaid]=useState(String(item?.paidCny??""));const [url,setUrl]=useState(item?.url??"");
  const packaged=["bag","box","bottle","pack"].includes(unit)||(unit==="piece"&&withPieceSpec);
  const packaging=packaged?{count:Number(count),container,contentAmount:Number(contentAmount),contentUnit}:undefined;
  const data:Omit<PurchaseDraft,"id">={name,foodId:foodId||undefined,platform,platformName:platform==="other"?platformName:undefined,orderedAt:orderedAt&&Number.isFinite(Date.parse(`${orderedAt}+08:00`))?new Date(`${orderedAt}+08:00`).toISOString():undefined,timezone:"Asia/Shanghai",expectedArrival:expected||undefined,amount:Number(amount),unit,packaging,packagingConfirmed:packaged?confirmed:undefined,priceCny:Number(price),paidCny:item?item.paidCny:paidMode==="unknown"?undefined:paidMode==="paid"?Number(price):paidMode==="later"?0:Number(paid),status:"ordered",confidence:"high",url:url||undefined};
  let preview="";try{const n=normalizePurchase({...data,packagingConfirmed:true});preview=`${purchaseSpecification(data)} → 合计 ${quantityText(n.amount)} ${purchaseUnitLabels[n.unit]}`;}catch{preview="填写包装内容后显示合计，不默认克与毫升相等。";}
  let base:string|undefined;try{base=normalizePurchase({...data,packagingConfirmed:true}).unit;}catch{/* specification still being entered */}
  function platformChange(value:PurchaseDraft["platform"]){setPlatform(value);if(!item)setExpected(shanghaiDate(new Date(Date.now()+(value==="duoduo"?1:value==="supermarket"?0:2)*864e5).toISOString()));}
  return <TransactionDialog title={item?"修订未收货订单":"记录采购订单"} onClose={onClose} data={data} confirmLabel={item?"保存订单修订":"保存订单，不增加库存"} onConfirm={id=>item?revise(item.id,data,id):save(data,id)}>
    <label><span>商品名称</span><input required maxLength={160} value={name} onChange={e=>setName(e.target.value)} placeholder="例如 认养减淳 0蔗糖酸奶"/></label>
    <div className="form-grid"><label><span>采购平台 / 渠道</span><select value={platform} onChange={e=>platformChange(e.target.value as PurchaseDraft["platform"])}>{Object.entries(platformLabels).filter(([key])=>key!=="online"||item?.platform==="online").map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>{platform==="other"&&<label><span>平台或门店名称</span><input maxLength={100} value={platformName} onChange={e=>setPlatformName(e.target.value)}/></label>}</div>
    <div className="form-grid"><label><span>下单时间（北京时间）</span><input type="datetime-local" step="1" value={orderedAt} onChange={e=>setOrderedAt(e.target.value)}/></label><label><span>预计到货日</span><input type="date" min={orderedAt.slice(0,10)||undefined} value={expected} onChange={e=>setExpected(e.target.value)}/></label></div>
    <p className="form-hint">下单、预计到货与实际收货分别记录。历史时间未知可留空，不补造。</p>
    <div className="form-grid"><label><span>购买数量</span><input required type="number" min="0.0001" step="any" value={amount} onChange={e=>setAmount(e.target.value)}/></label><label><span>购买单位</span><select value={unit} onChange={e=>{setUnit(e.target.value as PurchaseUnit);setConfirmed(false);setFoodId("");}}>{Object.entries(purchaseUnitLabels).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label></div>
    {unit==="piece"&&<label className="checkbox-label"><input type="checkbox" checked={withPieceSpec} onChange={e=>setWithPieceSpec(e.target.checked)}/><span>已知每个的净含量，按重量/容量入库</span></label>}
    {packaged&&<section className="specification-editor"><h3>每{purchaseUnitLabels[unit]}的商品规格</h3><div className="form-grid"><label><span>每件净含量</span><input required type="number" min="0.0001" step="any" value={contentAmount} onChange={e=>{setContentAmount(e.target.value);setConfirmed(false);}}/></label><label><span>净含量单位</span><select value={contentUnit} onChange={e=>{setContentUnit(e.target.value as typeof contentUnit);setFoodId("");setConfirmed(false);}}>{["g","kg","ml","l","piece"].map(u=><option key={u} value={u}>{purchaseUnitLabels[u as PurchaseUnit]}</option>)}</select></label><label><span>每{purchaseUnitLabels[unit]}包含几件</span><input required type="number" min="1" step="1" value={count} onChange={e=>{setCount(e.target.value);setConfirmed(false);}}/></label><label><span>内件包装</span><select value={container} onChange={e=>setContainer(e.target.value as typeof container)}>{["bag","box","bottle","piece"].map(u=><option key={u} value={u}>{purchaseUnitLabels[u as PurchaseUnit]}</option>)}</select></label></div><label className="checkbox-label"><input required type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/><span>我已核对规格与净含量。例如购买 1 组、每袋 1 kg、每组 2 袋。</span></label></section>}
    <p className="specification-preview" role="status">{preview}</p><FoodLinkSelect unit={base} value={foodId} onChange={setFoodId}/><p className="form-hint">这里保存采购和包装信息，不会自动生成营养资料；可以关联已经建档的食材库。</p>
    <div className="form-grid"><label><span>订单金额（优惠后，不等于已付款）</span><input required type="number" min="0" step="0.01" value={price} onChange={e=>setPrice(e.target.value)}/></label><label><span>付款状态</span><select disabled={!!item} value={paidMode} onChange={e=>setPaidMode(e.target.value)}><option value="unknown">暂未核对</option><option value="paid">已全额付款</option><option value="later">先用后付 / 尚未付款</option><option value="partial">已付部分金额</option></select></label></div>
    {paidMode==="partial"&&!item&&<label><span>目前已付款</span><input required type="number" min="0" step="0.01" value={paid} onChange={e=>setPaid(e.target.value)}/></label>}
    {item&&<p className="form-hint">修订规格不覆盖付款流水；付款/退款请使用“核对付款”。</p>}
    <label><span>商品链接（可选）</span><input type="url" value={url} onChange={e=>setUrl(e.target.value)} placeholder="https://…"/></label><p className="form-hint">保存订单不增加库存；收货时再核对实际数量、批次成本及到期日。</p>
  </TransactionDialog>;
}

export function ReceivePurchaseModal({purchase,onClose}:{purchase:PurchaseDraft;onClose:()=>void}) {
  const receive=useAppStore(s=>s.receivePurchaseActual);const outstanding=outstandingQuantity(purchase);let normalized:{amount:number;unit:InventoryLot["unit"]}|undefined;let error="";try{normalized=normalizePurchase(purchase,outstanding);}catch(cause){error=String(cause);}
  const [quantity,setQuantity]=useState(String(outstanding));const [amount,setAmount]=useState(String(normalized?.amount??""));const [cost,setCost]=useState(suggestedReceiptCost(purchase,outstanding).toFixed(2));const [receivedAt,setReceivedAt]=useState(shanghaiDate());const [expires,setExpires]=useState("");const [final,setFinal]=useState(false);const [reason,setReason]=useState("已核对实物、数量与分摊成本");const [replacement,setReplacement]=useState(false);const [name,setName]=useState("");const [foodId,setFoodId]=useState("");
  const data:ReceivePurchaseInput={purchaseId:purchase.id,quantity:Number(quantity),actualAmount:Number(amount),costCny:Number(cost),receivedAt,expiresAt:expires||undefined,final,reason,replacement:replacement?{name,foodId:foodId||undefined}:undefined};
  return <TransactionDialog title="核对实际收货" onClose={onClose} data={data} confirmLabel="确认实收并建立库存批次" onConfirm={id=>error?Promise.resolve({error}):receive(data,id)}>
    <div className="order-reference"><strong>{purchase.name}</strong><span>{purchaseSpecification(purchase)}</span><span>下单 {displayOrderedAt(purchase.orderedAt)}</span></div>{error&&<p className="form-error">{error} 请先修订订单。</p>}
    <div className="form-grid"><label><span>本次收到的购买数量（{purchaseUnitLabels[purchase.unit]}，最多 {quantityText(outstanding)}）</span><input required type="number" min="0.0001" max={outstanding} step="any" value={quantity} onChange={e=>{setQuantity(e.target.value);try{setAmount(String(normalizePurchase(purchase,Number(e.target.value)).amount));setCost(suggestedReceiptCost(purchase,Number(e.target.value)).toFixed(2));}catch{/* keep editable values */}}}/></label><label><span>实际入库数量（{normalized?purchaseUnitLabels[normalized.unit]:"基础单位"}）</span><input required type="number" min="0.0001" step="any" value={amount} onChange={e=>setAmount(e.target.value)}/></label></div>
    <p className="form-hint">数量和成本初值按订单比例估算，请按实物校正。例如 1 组 2 袋只收到 1 袋，可填 0.5 组。不同计量维度的替换请结束余单并另建采购，不换算克与毫升。</p>
    <div className="form-grid"><label><span>本批食材成本（不是本次付款）</span><input required type="number" min="0" step="0.01" value={cost} onChange={e=>setCost(e.target.value)}/></label><label><span>实际收货日</span><input required type="date" max={shanghaiDate()} value={receivedAt} onChange={e=>setReceivedAt(e.target.value)}/></label></div>
    <label><span>到期日 / 开封后使用期限（可留空）</span><input type="date" value={expires} onChange={e=>setExpires(e.target.value)}/></label><label className="checkbox-label"><input type="checkbox" checked={replacement} onChange={e=>setReplacement(e.target.checked)}/><span>收到的是替换商品，不沿用原食材身份</span></label>
    {replacement&&<><label><span>替换商品名称</span><input required maxLength={160} value={name} onChange={e=>setName(e.target.value)}/></label><FoodLinkSelect value={foodId} onChange={setFoodId} unit={normalized?.unit}/></>}
    <label className="checkbox-label"><input type="checkbox" checked={final} onChange={e=>setFinal(e.target.checked)}/><span>缺少部分不再发货，本次收货后结束余单（不会自动记退款）</span></label><label><span>收货核对 / 差异说明</span><input required maxLength={240} value={reason} onChange={e=>setReason(e.target.value)}/></label>
  </TransactionDialog>;
}

export function InventoryLotModal({lot,mode,onClose}:{lot:InventoryLot;mode:"count"|"return"|"waste";onClose:()=>void}) {
  const count=useAppStore(s=>s.countInventory);const dispose=useAppStore(s=>s.disposeInventory);
  const [amount,setAmount]=useState(String(mode==="count"?lot.remainingAmount:""));const [opened,setOpened]=useState(lot.opened);const [expires,setExpires]=useState(lot.expiresAt??"");const [reason,setReason]=useState("");const [refund,setRefund]=useState("");
  const data={lotId:lot.id,remainingAmount:Number(amount),opened,expiresAt:expires||null,reason};const loss={lotId:lot.id,amount:Number(amount),kind:mode==="return"?"return" as const:"waste" as const,reason,refundCny:mode==="return"&&refund!==""?Number(refund):undefined};
  return <TransactionDialog title={mode==="count"?"盘点与批次资料":mode==="return"?"确认实际退货":"记录腐坏 / 损耗"} onClose={onClose} data={mode==="count"?data:loss} onConfirm={id=>mode==="count"?count(data,id):dispose(loss,id)} confirmLabel={mode==="count"?"保存盘点并记录审计":mode==="return"?"确认已退回，扣减库存":"确认损耗，扣减库存"}>
    <div className="order-reference"><strong>{lot.name}</strong><span>当前余量 {quantityText(lot.remainingAmount)} {purchaseUnitLabels[lot.unit]}</span></div><label><span>{mode==="count"?"盘点后余量":"本次扣减数量"}（{purchaseUnitLabels[lot.unit]}）</span><input required type="number" min={mode==="count"?"0":"0.0001"} step="any" value={amount} onChange={e=>setAmount(e.target.value)}/></label>
    {mode==="count"&&<><label className="checkbox-label"><input type="checkbox" checked={opened} onChange={e=>setOpened(e.target.checked)}/><span>已开封（整个批次状态）</span></label><label><span>到期日 / 开封后使用期限</span><input type="date" value={expires} onChange={e=>setExpires(e.target.value)}/></label><p className="form-hint">留空会清除到期日，不以 AI 推断食品安全。需要分别跟踪每袋开封时，请在收货时逐袋建批次；本版尚不支持事后拆分批次。盘点不改历史餐食，也不能补回已退货/损耗。</p></>}
    {mode==="return"&&<><label><span>本次已实际到账退款（未到账请留空）</span><input type="number" min="0" step="0.01" value={refund} onChange={e=>setRefund(e.target.value)}/></label><p className="form-hint">此操作表示食材已经退回，不是申请售后。退款留空不会算作已退款；之后可在采购流水核对付款。</p></>}
    <label><span>原因（必填）</span><input required maxLength={240} value={reason} onChange={e=>setReason(e.target.value)}/></label>
  </TransactionDialog>;
}
export function PurchaseActionModal({purchase,mode,onClose}:{purchase:PurchaseDraft;mode:"close"|"payment";onClose:()=>void}) {
  const close=useAppStore(s=>s.closePurchase);const payment=useAppStore(s=>s.recordPurchasePayment);const [reason,setReason]=useState("");const [paid,setPaid]=useState(String(purchase.paidCny??""));const [refunded,setRefunded]=useState(String(purchase.refundedCny??0));
  const data={purchaseId:purchase.id,paidCny:Number(paid),refundedCny:Number(refunded),reason};
  return <TransactionDialog title={mode==="close"?"取消未收货部分":"核对付款与退款"} onClose={onClose} data={data} onConfirm={id=>mode==="close"?close(purchase.id,reason,id):payment(purchase.id,Number(paid),Number(refunded),reason,id)} confirmLabel={mode==="close"?"确认结束余单，不影响已收库存":"确认资金记录（不执行支付）"}>
    <div className="order-reference"><strong>{purchase.name}</strong><span>订单金额 ¥{purchase.priceCny.toFixed(2)} · {purchaseSpecification(purchase)}</span></div>{mode==="payment"?<div className="form-grid"><label><span>累计已付款（不是本次增量）</span><input required type="number" min="0" step="0.01" value={paid} onChange={e=>setPaid(e.target.value)}/></label><label><span>累计已到账退款</span><input required type="number" min="0" step="0.01" value={refunded} onChange={e=>setRefunded(e.target.value)}/></label></div>:<p className="form-hint">待收 {quantityText(outstandingQuantity(purchase))} {purchaseUnitLabels[purchase.unit]}将结束，不会增加库存或自动退款。已收货物的退货请从库存批次操作。</p>}
    <label><span>核对 / 结束原因</span><input required maxLength={240} value={reason} onChange={e=>setReason(e.target.value)}/></label>
  </TransactionDialog>;
}
