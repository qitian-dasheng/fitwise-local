import { diaryToday, type DiaryDateProps } from "../domain/diary";
import { DiaryDateControl } from "../components/DiaryDateControl";
import { BookOpen, ChefHat, Plus, ShieldCheck, UtensilsCrossed } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { MealEntry, RecipeVersion, MealType } from "../domain/types";
import { useAppStore } from "../store/appStore";
import { Modal } from "../components/Modal";
import { PageHeader } from "../components/PageHeader";
import { useConfirmedAction } from "../components/useConfirmedAction";
import type { ActionResult } from "../store/appStore";
import { FoodLibraryModal } from "../components/FoodLibraryModal";
import { MealCorrectionModal } from "../components/MealCorrectionModal";
import { RecipeEditor } from "../components/RecipeEditor";
import { RecipeManagerDrawer } from "../components/RecipeManagerDrawer";
import { RecipeMealDraftModal } from "../components/RecipeMealDraftModal";
import { latestRecipes } from "../domain/recipes";
import { MealDiaryTable } from "../components/MealDiaryTable";
import { CopyMealModal } from "../components/CopyMealModal";
import { mealCopySource, mealLabels, mealTypes, type MealCopySource } from "../domain/meals";
import { readDiaryShowSodium, writeDiaryShowSodium } from "../domain/preferences";
import { useEnergyUnit } from "../hooks/useEnergyUnit";
import { energyUnitLabels } from "../domain/energyDisplay";
import { foodUnitLabels } from "../domain/foodLibrary";
import { nutrientText } from "../domain/nutritionDisplay";

export function FoodPage({ date = diaryToday(), onDateChange, autoOpenMeal, autoOpenMealType, onAutoOpenConsumed }: DiaryDateProps & { autoOpenMeal?: boolean; autoOpenMealType?: MealType; onAutoOpenConsumed?: () => void } = {}) {
  const [correction,setCorrection]=useState<{meal:MealEntry;mode:"edit"|"void"}|null>(null);
  const [recipeEditor,setRecipeEditor]=useState<RecipeVersion|"new"|null>(null);
  const [selectedRecipeId,setSelectedRecipeId]=useState("");
  const [showHistory,setShowHistory]=useState(false);
  const [copyRecipe,setCopyRecipe]=useState(false);
  const [recipeDrawer,setRecipeDrawer]=useState(false);
  const [recipeMealOpen,setRecipeMealOpen]=useState(false);
  const [showSodium,setShowSodium]=useState(readDiaryShowSodium);
  const [mealOpen, setMealOpen] = useState(false);
  const [copyTarget, setCopyTarget] = useState<{ type: MealType; source: MealCopySource } | null>(null);
  const [manualMeal, setManualMeal] = useState(false);
  const [initialMealType, setInitialMealType] = useState<MealType>("breakfast");
  function openMeal(type: MealType = "breakfast") { setManualMeal(false); setInitialMealType(type); setMealOpen(true); }
  // 今日页「吃了什么」直达：按带来的餐次打开，而不是固定早餐；打开后立刻回报，避免重复触发。
  useEffect(() => {
    if (!autoOpenMeal) return;
    if (autoOpenMealType) setInitialMealType(autoOpenMealType);
    setMealOpen(true);
    onAutoOpenConsumed?.();
  }, [autoOpenMeal, autoOpenMealType, onAutoOpenConsumed]);
  function toggleSodium(visible: boolean) { setShowSodium(visible); writeDiaryShowSodium(visible); }
  const [energyUnit] = useEnergyUnit();
  const meals = useAppStore((state) => state.meals);
  const recipes = useAppStore((state) => state.recipes);
  const addMeal = useAppStore((state) => state.addMeal);
  const today = date;
  // 每个餐次能照搬哪一天：只在目标日期之前、同餐次、仍然有效的记录里取最近一天。
  const copySources = useMemo(
    () =>
      Object.fromEntries(mealTypes.map((type) => [type, mealCopySource(meals, type, today)])) as Partial<
        Record<MealType, MealCopySource | null>
      >,
    [meals, today],
  );
  const latest=latestRecipes(recipes);
  const recipeOptions=showHistory?recipes:latest;
  const recipe = recipeOptions.find(r=>r.id===selectedRecipeId)??recipeOptions[0];
  /** 编辑器盖在抽屉之上会形成双层遮罩，打开编辑器时先收起抽屉。 */
  function openRecipeEditor(target: RecipeVersion | "new", copy: boolean) {
    setCopyRecipe(copy);
    setRecipeEditor(target);
    setRecipeDrawer(false);
  }

  return (
    <div className="page food-page">
      <PageHeader eyebrow="实际摄入" title="饮食日记" description="新食物确认一次规格，以后选择食物、填写吃了多少，自动计算营养。" action={<button className="button primary" onClick={() => openMeal()}><Plus size={17} /> 添加食物</button>} />
      <DiaryDateControl date={date} onChange={onDateChange}/>
      <p className="form-hint">补录或新增餐食会把该日重新标为待核对，请在日报再次确认完成。</p>
      <MealDiaryTable
        date={today}
        entries={meals}
        showSodium={showSodium}
        onSodiumChange={toggleSodium}
        notes={{ protein: "目标约 100 g", fiber: "提醒线 25 g" }}
        onAdd={openMeal}
        copySources={copySources}
        onCopy={(type, source) => setCopyTarget({ type, source })}
        onEdit={(meal) => setCorrection({ meal, mode: "edit" })}
        onVoid={(meal) => setCorrection({ meal, mode: "void" })}
      />

      <div className="food-workbench">
        <section className="card kitchen-card">
          <div className="card-heading compact">
            <div>
              <p className="eyebrow">标准菜谱</p>
              <h2>今日下厨</h2>
            </div>
            <div className="card-heading-actions">
              <button className="button primary small" disabled={!recipe} onClick={() => setRecipeMealOpen(true)}><UtensilsCrossed size={15} /> 加入餐次</button>
              <button className="button secondary small" onClick={() => setRecipeDrawer(true)}><BookOpen size={15} /> 管理菜谱</button>
            </div>
          </div>

          {recipe ? (
            <div className="kitchen-body">
              <div className="kitchen-top">
                <div className="recipe-visual"><ChefHat size={30} /></div>
                <div className="kitchen-meta">
                  <p className="eyebrow">v{recipe.version} · {recipe.totalMinutes} 分钟</p>
                  <h3>{recipe.name}</h3>
                  <p>标准菜谱只作营养与分量参考；实际摄入请按餐次在日记中记录。</p>
                </div>
              </div>
              {!latest.some(r=>r.id===recipe.id)&&<p className="library-notice">正在复用历史 v{recipe.version}：展示沿用原版本的原料和营养，不会替换为最新版。</p>}
              <div className="recipe-macros"><span><b>{nutrientText(recipe.nutrition, "calories", energyUnit)}</b> {energyUnitLabels[energyUnit]}</span><span><b>{nutrientText(recipe.nutrition, "protein")}</b> g 蛋白质</span><span><b>{recipe.totalMinutes}</b> 分钟</span></div>
              <ul className="ingredient-list">{recipe.ingredients.map((item) => <li key={item.foodId}><span>{item.name}</span><b>{item.nutritionQuantity ?? item.amount} {foodUnitLabels[item.nutritionUnit ?? item.unit] ?? item.unit}</b></li>)}</ul>
            </div>
          ) : (
            <div className="kitchen-empty">
              <ChefHat size={26} />
              <strong>暂无标准菜谱</strong>
              <p>仍可通过食材库或仅记录本次入口记餐；固定搭配建议先建成菜谱，方便每次快速核对。</p>
              <button className="button secondary small" onClick={() => openRecipeEditor("new", false)}>新建第一个菜谱</button>
            </div>
          )}

          <p className="kitchen-footnote"><ShieldCheck size={15} /><span>营养值不会把空白当成零：首次商品会校验千焦／千卡、每份／每百克和净含量。</span></p>
        </section>
      </div>

      {recipeDrawer && <RecipeManagerDrawer
        recipes={recipes}
        latest={latest}
        options={recipeOptions}
        recipe={recipe}
        showHistory={showHistory}
        onShowHistoryChange={(visible) => { setShowHistory(visible); setSelectedRecipeId(""); }}
        onSelect={setSelectedRecipeId}
        onNew={() => openRecipeEditor("new", false)}
        onRevise={() => { if (recipe) openRecipeEditor(recipe, false); }}
        onCopy={() => { if (recipe) openRecipeEditor(recipe, true); }}
        onAddToMeal={() => setRecipeMealOpen(true)}
        onClose={() => setRecipeDrawer(false)}
      />}

      {recipeMealOpen && recipe && <RecipeMealDraftModal recipe={recipe} initialType="breakfast" initialDate={date} onClose={() => setRecipeMealOpen(false)} onRecorded={onDateChange} />}

      {correction&&<MealCorrectionModal meal={correction.meal} mode={correction.mode} onClose={()=>setCorrection(null)} onSaved={onDateChange}/>}
      {copyTarget && <CopyMealModal date={today} type={copyTarget.type} source={copyTarget.source} onClose={() => setCopyTarget(null)} />}
      {recipeEditor&&<RecipeEditor copyMode={copyRecipe} recipe={recipeEditor==="new"?undefined:recipeEditor} onClose={()=>setRecipeEditor(null)} onSaved={setSelectedRecipeId}/>}
      {meals.some(m=>m.date===date&&m.status&&m.status!=="active")&&<details className="card meal-correction-history"><summary>查看所选日修订／作废的原始记录</summary>{meals.filter(m=>m.date===date&&m.status&&m.status!=="active").map(m=><article key={m.id}><strong>{m.name} · {m.status==="void"?"已作废":"已修订"}</strong><p>{m.date} · {m.amountLabel} · 原始营养 {nutrientText(m.nutrition, "calories", energyUnit)} {energyUnitLabels[energyUnit]}（参考规格，非重新入账）</p><p>原因：{m.correctionReason}；原记录 ID：{m.id}</p></article>)}</details>}
      {mealOpen && <><div hidden={manualMeal}><FoodLibraryModal initialType={initialMealType} initialDate={date} onRecorded={onDateChange} onClose={() => setMealOpen(false)} onManual={() => setManualMeal(true)} /></div>{manualMeal && <MealModal initialType={initialMealType} initialDate={date} onBack={() => setManualMeal(false)} onRecorded={onDateChange} onClose={() => setMealOpen(false)} onSave={addMeal}/>}</>}
    </div>
  );
}

function MealModal({ onClose, onSave, initialType, initialDate, onBack, onRecorded }: { onClose: () => void; initialType: MealType; initialDate: string; onBack: () => void; onRecorded?: (date: string) => void; onSave: (input: { name: string; date: string; type: MealType; amountLabel: string; calories: number; protein: number; fiber?: number; carbohydrates?: number; fat?: number; sugar?: number; sodium?: number }, commandId?: string) => Promise<ActionResult> }) {
  const [form, setForm] = useState({ name: "", date: initialDate, type: initialType, amountLabel: "", calories: "", protein: "", fiber: "", carbs: "", fat: "", sugar: "", sodium: "" });
  const action = useConfirmedAction();
  return (
    <Modal title="仅记录本次餐食" onClose={() => { if (!action.busy) onClose(); }}>
      <form className="form" onSubmit={async (event) => { event.preventDefault(); const input = { name: form.name, date: form.date, type: form.type, amountLabel: form.amountLabel, calories: Number(form.calories), protein: Number(form.protein), fiber: form.fiber ? Number(form.fiber) : undefined, carbohydrates: form.carbs ? Number(form.carbs) : undefined, fat: form.fat ? Number(form.fat) : undefined, sugar: form.sugar ? Number(form.sugar) : undefined, sodium: form.sodium ? Number(form.sodium) : undefined }; const result = await action.run(JSON.stringify(input), (id) => onSave(input, id)); if (!result.error) { onRecorded?.(form.date); onClose(); } }}>
        <fieldset className="library-fields" disabled={action.busy}>
        <button type="button" className="text-button" onClick={onBack}>返回食材库（保留待确认食物）</button>
        <label><span>进食日期</span><input type="date" required max={diaryToday()} value={form.date} onChange={event => setForm({ ...form, date: event.target.value })}/></label>
        <label><span>餐次</span><select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value as MealType })}>{Object.entries(mealLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
        <label><span>食物或菜品名称</span><input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="例如 鸡蛋、燕麦与无糖酸奶" /></label>
        <label><span>份量说明</span><input required value={form.amountLabel} onChange={(event) => setForm({ ...form, amountLabel: event.target.value })} placeholder="例如 鸡蛋3个、燕麦50克" /></label>
        <div className="form-grid"><label><span>热量 kcal</span><input required type="number" min="0" value={form.calories} onChange={(event) => setForm({ ...form, calories: event.target.value })} /></label><label><span>蛋白质 g</span><input required type="number" min="0" step="0.1" value={form.protein} onChange={(event) => setForm({ ...form, protein: event.target.value })} /></label></div>
        <label><span>膳食纤维 g（可留空，留空不等于 0）</span><input type="number" min="0" step="0.1" value={form.fiber} onChange={(event) => setForm({ ...form, fiber: event.target.value })} /></label>
        <div className="form-grid"><label><span>碳水 g（可留空）</span><input type="number" min="0" step="0.1" value={form.carbs} onChange={(event) => setForm({ ...form, carbs: event.target.value })} /></label><label><span>脂肪 g（可留空）</span><input type="number" min="0" step="0.1" value={form.fat} onChange={(event) => setForm({ ...form, fat: event.target.value })} /></label></div>
        <div className="form-grid"><label><span>糖 g（可留空）</span><input type="number" min="0" step="0.1" value={form.sugar} onChange={(event) => setForm({ ...form, sugar: event.target.value })} /></label><label><span>钠 mg（可留空）</span><input type="number" min="0" value={form.sodium} onChange={(event) => setForm({ ...form, sodium: event.target.value })} /></label></div>
        <p className="form-hint">留空的营养保持「未知」，不会按 0 计入日合计。</p>
        {action.message && <p className="form-error" role="alert">{action.message}</p>}
        <button className="button primary wide" type="submit" disabled={action.busy}>{action.busy ? "正在保存…" : "确认写入饮食日记"}</button>
        </fieldset>
      </form>
    </Modal>
  );
}
