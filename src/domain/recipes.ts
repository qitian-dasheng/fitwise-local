import { calculateFoodPortion } from "./foodLibrary";
import { nutrition } from "./calculations";
import { nutrientKeys, type AppState, type RecipeInput, type RecipeVersion } from "./types";
export function latestRecipes(recipes: RecipeVersion[]) {
  const map=new Map<string,RecipeVersion>();
  for(const recipe of recipes){const id=recipe.recipeId??recipe.id;if(!map.has(id)||map.get(id)!.version<recipe.version)map.set(id,recipe);}
  return [...map.values()];
}
// Preview only. Desktop saves independently recompute every quantity in Rust.
export function previewRecipe(state: Pick<AppState,"foodDefinitionVersions">, input:RecipeInput) {
  if(!input.ingredients.length)throw new Error("请添加至少一种原料。");
  const values:Partial<Record<typeof nutrientKeys[number],number>>={};
  const portions=input.ingredients.map(item=>{const version=state.foodDefinitionVersions.find(v=>v.id===item.foodVersionId);if(!version)throw new Error("请逐项选择已建档食材。");const portion=calculateFoodPortion(version,item.quantity,item.unit);const one=calculateFoodPortion(version,1,item.inventoryUnit);return {facts:portion.nutrition,amount:Number((portion.factor/one.factor).toFixed(4)),unit:item.inventoryUnit};});
  for(const key of nutrientKeys){if(portions.every(p=>p.facts[key].state!=="unknown")){values[key]=portions.reduce((sum,p)=>sum+(p.facts[key].value??0),0);if(!Number.isFinite(values[key]))throw new Error("营养汇总过大，请核对规格。");}}
  return {nutrition:nutrition(values,"personal"),portions};
}
