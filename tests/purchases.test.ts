import { beforeEach, expect, it } from "vitest";
import { createPersonalState } from "../src/domain/seed";
import type { PurchaseDraft, PurchaseUnit } from "../src/domain/types";
import { displayOrderedAt, normalizePurchase, purchaseSpecification, shanghaiDate, suggestedReceiptCost } from "../src/domain/purchases";
import { useAppStore } from "../src/store/appStore";
const yogurt:Omit<PurchaseDraft,"id">={name:"测试酸奶",platform:"pinduoduo",amount:1,unit:"pack",packaging:{count:2,container:"bag",contentAmount:1,contentUnit:"kg"},packagingConfirmed:true,priceCny:18.78,paidCny:0,orderedAt:"2026-10-19T10:17:31Z",status:"ordered",confidence:"high"};
beforeEach(()=>{delete (window as unknown as Record<string,unknown>).__TAURI_INTERNALS__;useAppStore.setState(structuredClone(createPersonalState()));});
it.each<[PurchaseUnit,number,string,number]>([["g",400,"g",400],["kg",2,"g",2000],["ml",500,"ml",500],["l",1.5,"ml",1500],["piece",12,"piece",12]])("converts %s purchase quantities without g/ml guesses",(unit,amount,base,total)=>{expect(normalizePurchase({amount,unit})).toEqual({amount:total,unit:base});});
it("preserves packaging description and timezone",()=>{expect(normalizePurchase(yogurt)).toEqual({amount:2000,unit:"g"});expect(purchaseSpecification(yogurt)).toContain("1 千克 × 2 袋");expect(displayOrderedAt(yogurt.orderedAt)).toContain("2026-10-19 18:17:31");expect(()=>normalizePurchase({...yogurt,packagingConfirmed:false})).toThrow("确认");expect(()=>normalizePurchase({amount:2,unit:"bag"})).toThrow("包装");});
it("separates ordering, partial receipt, close, payment, return and stock count",async()=>{
 const store=()=>useAppStore.getState();await store().addPurchase(yogurt,"order-example-01");await store().addPurchase(yogurt,"order-example-01");expect(store().purchases).toHaveLength(1);expect(store().inventory).toHaveLength(0);
 const id=store().purchases[0].id;await store().receivePurchaseActual({purchaseId:id,quantity:.5,actualAmount:980,costCny:9.39,receivedAt:shanghaiDate(),final:false,reason:"实称"},"receipt-example-01");expect(store().purchases[0].status).toBe("partially_received");expect(store().inventory[0].remainingAmount).toBe(980);expect(store().purchases[0].paidCny).toBe(0);
 await store().closePurchase(id,"缺货","close-example-01");expect(store().purchases[0].status).toBe("closed");expect(store().purchases[0].closedQuantity).toBe(.5);
 await store().recordPurchasePayment(id,18.78,0,"核对实付","payment-example-01");const lotId=store().inventory[0].id;
 await store().disposeInventory({lotId,amount:200,kind:"return",reason:"已退回",refundCny:1.88},"return-example-01");expect(store().inventory[0].remainingAmount).toBe(780);expect(store().purchases[0].refundedCny).toBe(1.88);
 expect((await store().countInventory({lotId,remainingAmount:981,opened:false,expiresAt:null,reason:"无效"})).error).toBeTruthy();expect(store().inventory[0].remainingAmount).toBe(780);
 await store().countInventory({lotId,remainingAmount:750,opened:true,expiresAt:"2026-10-22",reason:"盘点称重"},"count-example-01");expect(store().inventory[0]).toMatchObject({remainingAmount:750,opened:true,expiresAt:"2026-10-22"});expect(store().inventory[0].lastCountedAt).toBeTruthy();expect(store().meals).toHaveLength(0);
});
it("does not merge same-name foods or rewrite old records until explicitly revised",async()=>{
 const old:PurchaseDraft={id:"old-yogurt",foodId:"independent-food",name:"酸奶",platform:"online",amount:2000,unit:"g",priceCny:18.78,status:"ordered",confidence:"high"};useAppStore.setState({purchases:[old]});
 expect(useAppStore.getState().purchases[0].orderedAt).toBeUndefined();expect(useAppStore.getState().purchases[0].paidCny).toBeUndefined();
 expect(await useAppStore.getState().revisePurchase(old.id,{...yogurt,foodId:old.foodId,paidCny:undefined},"revise-old-01")).toEqual({});expect(useAppStore.getState().purchases[0].paidCny).toBeUndefined();
 await useAppStore.getState().addPurchase(yogurt,"order-same-name-02");expect(useAppStore.getState().purchases[1].foodId).not.toBe(old.foodId);
});
it("keeps a rejected refund atomic and distinguishes refunds pending from zero",async()=>{
 const s=()=>useAppStore.getState();await s().addPurchase({...yogurt,paidCny:undefined});const p=s().purchases[0];await s().receivePurchase(p.id);const lot=s().inventory[0];const before=lot.remainingAmount;
 const error=await s().disposeInventory({lotId:lot.id,amount:100,kind:"return",reason:"退款尚未核对",refundCny:1});expect(error.error).toBeTruthy();expect(s().inventory[0].remainingAmount).toBe(before);
 await s().disposeInventory({lotId:lot.id,amount:100,kind:"return",reason:"仅退货，退款未到账"});expect(s().inventory[0].remainingAmount).toBe(1900);expect(s().purchases[0].refundedCny).toBeUndefined();
});
it("allocates the final cent remainder and rejects changed retries",async()=>{
 const p:PurchaseDraft={...yogurt,id:"rounding",amount:3,priceCny:1,receipts:[{id:"r",lotId:"l",quantity:2,actualAmount:4000,unit:"g",costCny:.66,name:"测试",foodId:"f",receivedAt:shanghaiDate(),reason:"测试",replacement:false}]};expect(suggestedReceiptCost(p,1)).toBe(.34);
 await useAppStore.getState().addPurchase(yogurt,"same-command-01");const result=await useAppStore.getState().addPurchase({...yogurt,amount:2},"same-command-01");expect(result.error).toContain("命令内容");expect(useAppStore.getState().purchases[0].amount).toBe(1);
});
