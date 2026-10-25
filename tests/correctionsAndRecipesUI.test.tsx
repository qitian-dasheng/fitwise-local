import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MealCorrectionModal } from "../src/components/MealCorrectionModal";
import { RecipeEditor } from "../src/components/RecipeEditor";
import { FoodPage } from "../src/pages/FoodPage";
import { activeMeals, completedDayCalorieAverage, nutrition, summarizeMeals } from "../src/domain/calculations";
import { latestRecipes, previewRecipe } from "../src/domain/recipes";
import { diaryToday } from "../src/domain/diary";
import { initialState } from "../src/domain/seed";
import { useAppStore } from "../src/store/appStore";
import type { MealEntry } from "../src/domain/types";
let host:HTMLDivElement;let root:Root;
const close=vi.fn(),saved=vi.fn();
const originalCorrect=useAppStore.getState().correctMeal,originalRecipe=useAppStore.getState().saveRecipe;
beforeEach(()=>{(globalThis as Record<string,unknown>).IS_REACT_ACT_ENVIRONMENT=true;delete (window as unknown as Record<string,unknown>).__TAURI_INTERNALS__;useAppStore.setState({...structuredClone(initialState),correctMeal:originalCorrect,saveRecipe:originalRecipe});host=document.createElement("div");document.body.append(host);root=createRoot(host);close.mockReset();saved.mockReset();});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.restoreAllMocks();});
const button=(label:string)=>[...host.querySelectorAll("button")].find(b=>b.textContent?.includes(label))!;
const input=(label:string)=>[...host.querySelectorAll("label")].find(l=>l.textContent?.includes(label))!.querySelector<HTMLInputElement>("input")!;
async function fill(element:HTMLInputElement|HTMLTextAreaElement,value:string){await act(async()=>{Object.getOwnPropertyDescriptor(element instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,"value")!.set!.call(element,value);element.dispatchEvent(new Event("input",{bubbles:true}));});}
async function select(element:HTMLSelectElement,value:string){await act(async()=>{Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,"value")!.set!.call(element,value);element.dispatchEvent(new Event("change",{bubbles:true}));});}
async function submit(){await act(async()=>{host.querySelector("form")!.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}));});}
async function makeFood(){const result=await useAppStore.getState().saveFoodDefinition({name:"原味燕麦",brand:"示例",measurementBasis:"packaged",basis:{quantity:100,unit:"g"},energyUnit:"kcal",nutrients:{calories:400,protein:12,fat:0},conversions:[],source:"label"});return result;}
const meal:MealEntry={id:"meal-1",date:diaryToday(),type:"lunch",name:"原外食",amountLabel:"一份",nutrition:nutrition({calories:300,protein:20}),consumedRatio:1,source:"manual",confidence:"high",createdAt:""};

it("retains correction values and request identity on failure, requiring an explicit reason and confirmation",async()=>{
  const correct=vi.fn().mockResolvedValueOnce({error:"数据库暂不可用"}).mockResolvedValueOnce({date:meal.date});useAppStore.setState({correctMeal:correct});
  await act(async()=>root.render(<MealCorrectionModal meal={meal} onClose={close} onSaved={saved}/>));
  expect(button("确认更正").disabled).toBe(true);
  await fill(input("热量 kcal"),"150");await fill(host.querySelector("textarea")!,"原餐份量记多了");
  await act(async()=>input("我已核对修改").click());await submit();
  expect(host.textContent).toContain("数据库暂不可用");expect(input("热量 kcal").value).toBe("150");expect(host.querySelector("textarea")!.value).toBe("原餐份量记多了");expect(close).not.toHaveBeenCalled();
  await submit();expect(correct.mock.calls[0][2]).toBe(correct.mock.calls[1][2]);expect(correct.mock.calls[1][0].nutrients).toMatchObject({calories:150});expect(correct.mock.calls[1][0].nutrients.fiber).toBeUndefined();expect(saved).toHaveBeenCalledWith(meal.date);expect(close).toHaveBeenCalledOnce();
});

it("blocks closing and repeated submits while a meal correction is in flight",async()=>{
  let resolve!:(v:{error:string})=>void;const correct=vi.fn(()=>new Promise<{error:string}>(done=>{resolve=done;}));useAppStore.setState({correctMeal:correct});
  await act(async()=>root.render(<MealCorrectionModal meal={meal} onClose={close}/>));await fill(host.querySelector("textarea")!,"重复测试");await act(async()=>input("我已核对修改").click());await submit();await submit();
  await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="关闭"]')!.click());expect(close).not.toHaveBeenCalled();expect(correct).toHaveBeenCalledOnce();expect(host.querySelector("fieldset")!.disabled).toBe(true);
  await act(async()=>resolve({error:"保存失败"}));expect(host.querySelector("textarea")!.value).toBe("重复测试");
});

it("previews a corrected food portion using its fixed original nutrient version",async()=>{
  const food=await makeFood();await useAppStore.getState().recordFoodMeal({date:diaryToday(),type:"breakfast",entries:[{foodVersionId:food.foodVersionId!,quantity:500,unit:"g"}]});const original=useAppStore.getState().meals[0];
  await act(async()=>root.render(<MealCorrectionModal meal={original} onClose={close}/>));await fill(input("正确的摄入数量"),"50");expect(host.textContent).toContain("200 kcal");expect(host.textContent).toContain("沿用原 v1");
});

it("selects a food version, previews nutrition and only saves a recipe after all fields are valid",async()=>{
  const food=await makeFood();const save=vi.fn().mockResolvedValueOnce({error:"模拟保存失败"}).mockResolvedValueOnce({recipeVersionId:"saved-v1"});useAppStore.setState({saveRecipe:save});
  await act(async()=>root.render(<RecipeEditor onClose={close} onSaved={saved}/>));await fill(input("菜谱名称"),"燕麦粥");
  await select([...host.querySelectorAll("label")].find(l=>l.textContent?.includes("食材与营养版本"))!.querySelector("select")!,food.foodVersionId!);
  await fill(input("原料数量"),"50");expect(host.textContent).toContain("200 kcal");expect(host.textContent).toContain("纤维 未知");await submit();expect(host.textContent).toContain("模拟保存失败");expect(input("原料数量").value).toBe("50");await submit();
  expect(save.mock.calls[0][1]).toBe(save.mock.calls[1][1]);expect(save.mock.calls[1][0].ingredients[0]).toMatchObject({foodVersionId:food.foodVersionId,quantity:50});expect(save.mock.calls[1][0].nutrition).toBeUndefined();expect(saved).toHaveBeenCalledWith("saved-v1");expect(useAppStore.getState().meals).toHaveLength(0);
});

it("ignores superseded and void meals in summaries but exposes their original evidence",async()=>{
  const history=[{...meal,id:"old",status:"superseded" as const,correctionReason:"记错份量"},{...meal,id:"void",status:"void" as const,correctionReason:"重复记录"},{...meal,id:"new",nutrition:nutrition({calories:150,protein:10})}];
  useAppStore.setState({meals:history});expect(activeMeals(history)).toHaveLength(1);expect(summarizeMeals(history).totals.calories).toBe(150);expect(completedDayCalorieAverage(history,[{date:meal.date,complete:true}])).toBe(150);
  await act(async()=>root.render(<FoodPage/>));expect(host.querySelectorAll(".food-entry")).toHaveLength(1);expect(host.querySelector("details")?.textContent).toContain("重复记录");
});

it("deduplicates recipe identities to the latest version without changing prepared snapshots",()=>{
  const old=structuredClone(initialState.recipes[0]);const newer={...old,id:"new-v2",version:2,name:"新版"};expect(latestRecipes([old,newer])).toEqual([newer]);expect(old.version).toBe(1);
});
it("visits catalog-only food management without losing unfinished recipe fields or recording a meal",async()=>{
  await act(async()=>root.render(<RecipeEditor onClose={close} onSaved={saved}/>));await fill(input("菜谱名称"),"写到一半的菜谱");
  await act(async()=>button("管理／新建食材").click());expect(host.textContent).toContain("管理食材营养资料");
  const visibleLibrary=host.querySelector(".food-library")!;expect(visibleLibrary.textContent).not.toContain("确认写入");expect(visibleLibrary.textContent).not.toContain("仅记录本次");
  await act(async()=>visibleLibrary.closest(".modal")!.querySelector<HTMLButtonElement>('[aria-label="关闭"]')!.click());expect(input("菜谱名称").value).toBe("写到一半的菜谱");expect(useAppStore.getState().meals).toHaveLength(0);expect(close).not.toHaveBeenCalled();
});

it("does not fabricate successful desktop-only writes in browser previews",async()=>{
  const before=structuredClone(useAppStore.getState().meals);expect((await originalCorrect({mealId:meal.id,reason:"测试"},true)).error).toContain("需要桌面版");expect(useAppStore.getState().meals).toEqual(before);
  expect(()=>previewRecipe({foodDefinitionVersions:[]},{name:"空",totalMinutes:1,equipment:[],ingredients:[]})).toThrow("至少一种原料");
});
it("historical recipe picker keeps the selected version and only permits copy or original-version cooking", async () => {
  const old=structuredClone(initialState.recipes[0]),newer={...old,id:"recipe-v2",name:"新版配方",version:2};
  useAppStore.setState({recipes:[old,newer]});await act(async()=>root.render(<FoodPage/>));
  // 菜谱管理控件已收进抽屉：主页不再出现下拉与管理按钮组。
  expect(host.querySelector('select[aria-label="选择标准菜谱"]')).toBeNull();
  expect(host.querySelector(".drawer")).toBeNull();
  expect([...host.querySelectorAll("button")].filter(b=>["新建菜谱","修订当前菜谱","另存为新菜谱"].includes(b.textContent?.trim()??""))).toHaveLength(0);
  await act(async()=>(host.querySelector(".food-recipe-btn") as HTMLButtonElement).click());
  expect(host.querySelector(".drawer")!.textContent).toContain("管理菜谱");
  const picker=()=>host.querySelector<HTMLSelectElement>('select[aria-label="选择标准菜谱"]')!;
  expect(picker().textContent).not.toContain("（历史）");
  await act(async()=>input("菜谱管理：显示历史版本").click());await select(picker(),old.id);
  expect(host.textContent).toContain("正在复用历史 v1");expect(button("修订当前菜谱").disabled).toBe(true);
  await act(async()=>button("另存为新菜谱").click());
  expect(host.querySelector(".drawer")).toBeNull();
  expect(host.textContent).toContain("另存历史配方");expect(input("菜谱名称").value).toBe(old.name+"（副本）");
});
it("save-as creates independent recipe identity while pinning historical food versions and source", async () => {
  const food=await makeFood(),save=vi.fn().mockResolvedValue({recipeVersionId:"copy-v1"});useAppStore.setState({saveRecipe:save});
  const recipe={...structuredClone(initialState.recipes[0]),ingredients:[{foodId:food.foodId!,name:"原味燕麦",amount:50,unit:"g" as const,measurementBasis:"package" as const,foodVersionId:food.foodVersionId,nutritionQuantity:50,nutritionUnit:"g" as const}]};
  await act(async()=>root.render(<RecipeEditor recipe={recipe} copyMode onClose={close} onSaved={saved}/>));
  await submit();
  expect(save).toHaveBeenCalledOnce();const payload=save.mock.calls[0][0];expect(payload.recipeId).toBeUndefined();expect(payload.expectedVersionId).toBeUndefined();expect(payload.copiedFromVersionId).toBe(recipe.id);expect(payload.ingredients[0].foodVersionId).toBe(food.foodVersionId);expect(payload.ingredients[0].quantity).toBe(50);
});
it("splits edit and void row entries and previews before/after values",async()=>{
  await act(async()=>{useAppStore.setState({meals:[meal]});root.render(<FoodPage/>);});
  const entry=host.querySelector(".food-entry")!;
  expect([...entry.querySelectorAll("button")].map(b=>b.textContent?.trim())).toEqual(["编辑","作废"]);
  await act(async()=>button("编辑").click());
  expect(host.textContent).toContain("更正餐食记录");
  const diff=()=>host.querySelector(".correction-diff")!;
  expect(diff().textContent).toContain("午餐");
  expect(diff().textContent).toContain(meal.date);
  expect(diff().textContent).toContain("原外食 · 一份");
  await act(async()=>select([...host.querySelectorAll("label")].find(l=>l.textContent?.includes("餐次"))!.querySelector("select")!,"dinner"));
  expect(diff().textContent).toContain("晚餐");
  expect(host.querySelector(".correction-diff .changed")).not.toBeNull();
  await act(async()=>fill([...host.querySelectorAll("input")].find(i=>i.type==="text"&&i.value==="原外食")!,"便利店饭团"));
  expect(diff().textContent).toContain("便利店饭团");
});
it("opens void mode directly from the row with semantics explained",async()=>{
  await act(async()=>{useAppStore.setState({meals:[meal]});root.render(<FoodPage/>);});
  await act(async()=>button("作废").click());
  expect(host.textContent).toContain("作废餐食记录");
  expect(input("作废此条").checked).toBe(true);
  expect(host.textContent).toContain("不删除食材库、不返还生鲜");
  expect(host.querySelector(".correction-diff")).toBeNull();
  expect(host.querySelector("form input[type=date]")).toBeNull();
});
