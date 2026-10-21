import type { AppState, InventoryLot, InventoryMovement, PurchaseDraft, PurchasePlatform, PurchaseUnit, ReceivePurchaseInput } from "./types";

export const platformLabels: Record<PurchasePlatform,string> = { pinduoduo:"拼多多", duoduo:"多多买菜", taobao:"淘宝", tmall:"天猫", jd:"京东", douyin:"抖音商城", meituan:"美团", supermarket:"超市", other:"其他平台/渠道", online:"网购（旧记录未注明平台）" };
export const purchaseUnitLabels: Record<PurchaseUnit,string> = { g:"克", kg:"千克", ml:"毫升", l:"升", piece:"个", bag:"袋", box:"盒", bottle:"瓶", pack:"组" };
export const purchaseStatusLabels: Record<PurchaseDraft["status"],string> = { draft:"草稿", ordered:"待收货", partially_received:"部分收货", received:"已收齐", cancelled:"已取消", closed:"已结束余单" };
export const quantityText = (n:number) => String(Number(n.toFixed(4)));
export function numberChecked(n:number, positive=false) { if(!Number.isFinite(n)||n<0||(positive&&n===0)) throw new Error("数量/金额必须是有效的非负数，收货数量必须大于 0。");return n; }
function money(n:number) { numberChecked(n); if(n>1e8||Math.abs(n*100-Math.round(n*100))>.00001)throw new Error("金额最多保留两位小数。");return n; }
export function normalizePurchase(pick: Pick<PurchaseDraft,"amount"|"unit"|"packaging"|"packagingConfirmed">, quantity=pick.amount): {amount:number;unit:InventoryLot["unit"]} {
  numberChecked(quantity,true);
  const base=(unit:string): {unit:InventoryLot["unit"];scale:number} => { switch(unit){case "g":return{unit:"g",scale:1};case "kg":return{unit:"g",scale:1000};case "ml":return{unit:"ml",scale:1};case "l":return{unit:"ml",scale:1000};case "piece":return{unit:"piece",scale:1};default:throw new Error("请补充并确认包装内容规格。");} };
  let amount:number;let unit:InventoryLot["unit"];
  if(pick.packaging){const p=pick.packaging;if(!pick.packagingConfirmed||!["bag","box","bottle","pack","piece"].includes(pick.unit)||!Number.isInteger(p.count)||p.count<=0)throw new Error("请核对并确认包装规格与件数。");const ref=base(p.contentUnit);amount=quantity*p.count*numberChecked(p.contentAmount,true)*ref.scale;unit=ref.unit;}
  else{const ref=base(pick.unit);amount=quantity*ref.scale;unit=ref.unit;}
  if(!Number.isFinite(amount)||amount<.0001||amount>1e9)throw new Error("换算数量超出有效范围。");
  return {amount:Math.round(amount*10000)/10000,unit};
}
export function purchaseSpecification(p:Pick<PurchaseDraft,"amount"|"unit"|"packaging">) {
  const prefix=`${quantityText(p.amount)} ${purchaseUnitLabels[p.unit]}`;
  if(!p.packaging)return prefix;
  const content=`${quantityText(p.packaging.contentAmount)} ${purchaseUnitLabels[p.packaging.contentUnit]}`;
  return p.packaging.count===1&&p.packaging.container===p.unit?`${prefix} · 每${purchaseUnitLabels[p.unit]} ${content}`:`${prefix} · ${content} × ${p.packaging.count} ${purchaseUnitLabels[p.packaging.container]}/${purchaseUnitLabels[p.unit]}`;
}
export function receivedQuantity(p:PurchaseDraft){return p.receipts?.reduce((sum,r)=>sum+r.quantity,0)??(p.status==="received"?p.amount:0);}
export function outstandingQuantity(p:PurchaseDraft){return Math.max(0,p.amount-receivedQuantity(p)-(p.closedQuantity??0));}
export function suggestedReceiptCost(p:PurchaseDraft,quantity:number){const previous=p.receipts?.reduce((s,r)=>s+r.costCny,0)??0;return Math.round(Math.max(0,quantity>=outstandingQuantity(p)-.00001?p.priceCny-previous:p.priceCny*quantity/p.amount)*100)/100;}
import { localShanghaiInput, shanghaiDate } from "./time";
export { localShanghaiInput, shanghaiDate };
export function displayOrderedAt(value?:string){return value?localShanghaiInput(value).replace("T"," ")+"（北京时间）":"未记录";}
export function validatePurchase(draft:Omit<PurchaseDraft,"id">){
  if(!draft.name.trim()||draft.name.length>160)throw new Error("请填写有效的商品名称。");
  if(!(draft.platform in platformLabels)||!["ordered","draft"].includes(draft.status))throw new Error("采购平台/状态无效。");
  normalizePurchase(draft);money(draft.priceCny);
  if(draft.paidCny!==undefined&&money(draft.paidCny)>draft.priceCny)throw new Error("已付款不能大于订单金额。");
  if(draft.orderedAt&&!Number.isFinite(Date.parse(draft.orderedAt)))throw new Error("下单时间无效。");
  if(draft.expectedArrival&&!/^\d{4}-\d{2}-\d{2}$/.test(draft.expectedArrival))throw new Error("预计到货日期无效。");
  if(draft.orderedAt&&draft.expectedArrival&&draft.expectedArrival<shanghaiDate(draft.orderedAt))throw new Error("预计到货不能早于下单日期。");
  if(draft.url&&!/^https?:\/\//.test(draft.url))throw new Error("商品链接仅支持 http/https。");
}

// Browser development preview only; the installed app always sends a Rust domain command.
export function applyInventoryOperation(state:AppState,kind:string,payload:Record<string,unknown>,commandId:string):AppState {
  const next=structuredClone(Object.fromEntries(Object.entries(state).filter(([,v])=>typeof v!=="function"))) as AppState;
  const replay=next.auditEvents.find(a=>a.id===`${commandId}:audit`);
  if(replay){if(replay.eventType!==kind||JSON.stringify(replay.payload.input)!==JSON.stringify(payload))throw new Error("命令内容与原提交不同。");return state;}
  const now=new Date().toISOString(); const input=payload as unknown as ReceivePurchaseInput;
  const purchase=()=>{const p=next.purchases.find(v=>v.id===payload.purchaseId);if(!p)throw new Error("找不到采购记录。");return p;};
  const open=(p:PurchaseDraft)=>{if(!["ordered","partially_received"].includes(p.status))throw new Error("这笔采购不能继续收货/修改。");};
  let before:unknown=null;let entityId="";
  const linked=(id:string|undefined,unit:string,fallback:string)=>{if(!id)return `food-${fallback}`;
    const known=next.inventory.some(v=>v.foodId===id&&v.unit===unit)||next.recipes.some(r=>r.ingredients.some(v=>v.foodId===id&&v.unit===unit))||next.foodDefinitions.some(d=>d.id===id&&next.foodDefinitionVersions.some(v=>v.id===d.activeVersionId&&(v.basis.unit===unit||v.conversions.some(c=>c.unit===unit))));
    if(!known)throw new Error("关联食材不存在或基础计量单位不匹配。");return id;};
  if(kind==="add_purchase"||kind==="revise_purchase"){
    const draft=payload as unknown as Omit<PurchaseDraft,"id">;validatePurchase(draft);const normalized=normalizePurchase(draft);
    const existing=kind==="revise_purchase"?purchase():undefined;if(existing){open(existing);if(receivedQuantity(existing)>0)throw new Error("已有收货批次，不能重写订单。");before=structuredClone(existing);}
    entityId=existing?.id??`record-${commandId}`;
    const keepLink=existing&&existing.foodId===draft.foodId&&normalizePurchase(existing).unit===normalized.unit;
    const updated:PurchaseDraft={...draft,id:entityId,name:draft.name.trim(),foodId:keepLink?existing.foodId:linked(draft.foodId,normalized.unit,entityId),createdAt:existing?.createdAt??now};
    if(existing){updated.paidCny=existing.paidCny;updated.refundedCny=existing.refundedCny;Object.assign(existing,updated);}else next.purchases.push(updated);
  }else if(kind==="receive_purchase"){
    const p=purchase();open(p);before=structuredClone(p);entityId=p.id;
    const quantity=input.quantity??outstandingQuantity(p);numberChecked(quantity,true);if(quantity>outstandingQuantity(p)+.00001)throw new Error("收货数量超过未收货数量。");
    const normalized=normalizePurchase(p,quantity);const hasActual=payload.actualAmount!==undefined;const actual=hasActual?numberChecked(Number(input.actualAmount),true):normalized.amount;const cost=money(input.costCny??Math.round(p.priceCny*quantity/p.amount*100)/100);
    const receivedAt=input.receivedAt??shanghaiDate();if(receivedAt>shanghaiDate()||(p.orderedAt&&receivedAt<shanghaiDate(p.orderedAt)))throw new Error("实际收货日期无效。");
    const lotId=`lot-${commandId}`;const receiptId=`receipt-${commandId}`;const foodId=input.replacement?linked(input.replacement.foodId,normalized.unit,commandId):(p.foodId??`food-${p.id}`);const name=input.replacement?.name??p.name;
    p.receipts??=[];p.receipts.push({id:receiptId,lotId,quantity,actualAmount:actual,unit:normalized.unit,costCny:cost,name,foodId,receivedAt,expiresAt:input.expiresAt,reason:input.reason??"按订单收货",replacement:!!input.replacement,basis:hasActual?"weighed":"nominal"});
    const remaining=outstandingQuantity(p);const final=input.final??true;p.status=remaining<.00001?"received":final?"closed":"partially_received";if(final&&remaining>=.00001){p.closedQuantity=remaining;p.closedReason=input.reason;}
    next.inventory.push({id:lotId,purchaseId:p.id,receiptId,foodId,name,purchasedAmount:actual,remainingAmount:actual,unit:normalized.unit,purchasePriceCny:cost,purchasedAt:p.orderedAt?shanghaiDate(p.orderedAt):receivedAt,receivedAt,expiresAt:input.expiresAt,opened:false,confidence:p.confidence,source:p.platform,specification:purchaseSpecification(p),nominalAmount:normalized.amount,receiptBasis:hasActual?"weighed":"nominal",weighedAt:hasActual?now:undefined});
    next.inventoryMovements.push({id:`${commandId}:movement`,lotId,type:"purchase",amount:actual,reason:input.reason??"确认收货",createdAt:now});
  }else if(kind==="correct_receipt_weight"){
    const lot=next.inventory.find(l=>l.id===payload.lotId);if(!lot)throw new Error("找不到库存批次。");before=structuredClone(lot);entityId=lot.id;
    const actual=numberChecked(Number(payload.actualAmount),true);if(actual<.0001||actual>1e9)throw new Error("补录实重数量超出有效范围。");
    if(!String(payload.reason??"").trim())throw new Error("命令缺少 reason。");
    const guidance="请使用盘点调整当前余量。";
    if(!lot.purchaseId)throw new Error(`此批次未关联采购，不能补录实重；${guidance}`);
    if(!lot.receiptId)throw new Error(`此批次未关联收货记录，不能补录实重；${guidance}`);
    const order=next.purchases.find(v=>v.id===lot.purchaseId);if(!order)throw new Error(`找不到关联采购记录，不能补录实重；${guidance}`);
    const receipt=(order.receipts??[]).find(r=>r.id===lot.receiptId);if(!receipt)throw new Error(`找不到关联收货记录，不能补录实重；${guidance}`);
    const lotMovements=next.inventoryMovements.filter(m=>m.lotId===lot.id);
    for(const movement of lotMovements){if(movement.type!=="purchase"&&movement.type!=="receipt_correction")throw new Error(`此批次已有制作、退货、损耗或盘点记录，不能补录实重；${guidance}`);}
    if(lotMovements.filter(m=>m.type==="purchase").length!==1)throw new Error(`此批次的入库流水不完整，不能补录实重；${guidance}`);
    if((lot.returnedAmount??0)>0||(lot.wastedAmount??0)>0)throw new Error(`此批次已有退货或损耗记录，不能补录实重；${guidance}`);
    if(Math.abs(lot.remainingAmount-lot.purchasedAmount)>1e-6)throw new Error(`此批次余量与实收不一致，不能补录实重；${guidance}`);
    const purchased=lot.purchasedAmount;const corrected=Math.round(actual*10000)/10000;
    receipt.actualAmount=corrected;receipt.basis="weighed";
    lot.purchasedAmount=corrected;lot.remainingAmount=corrected;lot.receiptBasis="weighed";lot.weighedAt=now;
    next.inventoryMovements.push({id:`${commandId}:movement`,lotId:lot.id,type:"receipt_correction",amount:corrected-purchased,correctsReceiptId:lot.receiptId,reason:String(payload.reason),createdAt:now});
  }else if(kind==="close_purchase"){
    const p=purchase();open(p);before=structuredClone(p);entityId=p.id;if(!String(payload.reason??"").trim())throw new Error("请填写结束余单的原因。");p.closedQuantity=outstandingQuantity(p);p.closedReason=String(payload.reason);p.status=receivedQuantity(p)>0?"closed":"cancelled";
  }else if(kind==="update_purchase_payment"){
    const p=purchase();before=structuredClone(p);entityId=p.id;if(!String(payload.reason??"").trim())throw new Error("请填写核对原因。");const paid=money(Number(payload.paidCny));const refund=money(Number(payload.refundedCny));if(refund>paid||paid>Math.max(p.priceCny,(p.receipts??[]).reduce((sum,r)=>sum+r.costCny,0)))throw new Error("请核对累计付款/退款金额。");p.paidCny=paid;p.refundedCny=refund;
  }else{
    const lot=next.inventory.find(l=>l.id===payload.lotId);if(!lot)throw new Error("找不到库存批次。");before=structuredClone(lot);entityId=lot.id;const current=lot.remainingAmount;
    if(!String(payload.reason??"").trim())throw new Error("请填写操作原因。");
    if(kind==="adjust_inventory"){
      const remaining=numberChecked(Number(payload.remainingAmount));if(remaining>lot.purchasedAmount-(lot.returnedAmount??0)-(lot.wastedAmount??0)+.00001)throw new Error("盘点不能超过可用收货上限。");lot.remainingAmount=remaining;lot.lastCountedAt=now;if(payload.opened!==undefined){lot.opened=!!payload.opened;lot.openedAt=lot.opened?(lot.openedAt??now):undefined;}if(payload.expiresAt!==undefined)lot.expiresAt=payload.expiresAt?String(payload.expiresAt):undefined;
    }else if(kind==="dispose_inventory"){
      const amount=numberChecked(Number(payload.amount),true);if(amount>current+.00001)throw new Error("退货或损耗不能超过余量。");lot.remainingAmount=Math.max(0,current-amount);
      if(payload.kind==="return"){lot.returnedAmount=(lot.returnedAmount??0)+amount;if(payload.refundCny!==undefined){const p=next.purchases.find(p=>p.id===lot.purchaseId);if(!p||p.paidCny===undefined)throw new Error("请先核对订单付款金额。");const refund=money(Number(payload.refundCny));if((p.refundedCny??0)+refund>p.paidCny)throw new Error("退款超过已付款。");p.refundedCny=(p.refundedCny??0)+refund;}}
      else if(payload.kind==="waste")lot.wastedAmount=(lot.wastedAmount??0)+amount;else throw new Error("损耗类型无效。");
    }else throw new Error("未知库存操作。");
    next.inventoryMovements.push({id:`${commandId}:movement`,lotId:lot.id,type:kind==="adjust_inventory"?"adjustment":payload.kind as "return"|"waste",amount:lot.remainingAmount-current,reason:String(payload.reason),createdAt:now});
  }
  next.auditEvents.push({id:`${commandId}:audit`,entityId,eventType:kind,entityType:"inventory_or_purchase",payload:{commandId,before,input:payload},createdAt:now});return next;
}

// 0.4.6-A 补录实重：标称量、实收状态与入口分流判断。旧批次无新字段时回退显示。
export const lotNominalAmount=(lot:InventoryLot)=>lot.nominalAmount??lot.purchasedAmount;
export const lotUnitCost=(lot:InventoryLot)=>lot.purchasedAmount>0?lot.purchasePriceCny/lot.purchasedAmount:0;
export function receiptBasisLabel(lot:InventoryLot){
  if(lot.receiptBasis==="weighed")return "已称重";
  if(lot.receiptBasis==="nominal")return "标称估算";
  return "旧记录（未保存标称量）";
}
// 与 Rust correct_receipt_weight 守卫逐条对应；返回 null 表示可以补录实重。
export function receiptCorrectionBlockReason(lot:InventoryLot,movements:InventoryMovement[]):string|null{
  if(!lot.purchaseId||!lot.receiptId)return "旧批次未关联收货记录，不能补录实重；请使用盘点调整余量。";
  const lotMovements=movements.filter(m=>m.lotId===lot.id);
  for(const movement of lotMovements){if(movement.type!=="purchase"&&movement.type!=="receipt_correction")return "此批次已有制作、退货、损耗或盘点记录，不能补录实重；请使用盘点调整余量。";}
  if(lotMovements.filter(m=>m.type==="purchase").length!==1)return "此批次的入库流水不完整，不能补录实重；请使用盘点调整余量。";
  if((lot.returnedAmount??0)>0||(lot.wastedAmount??0)>0)return "此批次已有退货或损耗记录，不能补录实重；请使用盘点调整余量。";
  if(Math.abs(lot.remainingAmount-lot.purchasedAmount)>1e-6)return "此批次余量与实收不一致，不能补录实重；请使用盘点调整余量。";
  return null;
}
