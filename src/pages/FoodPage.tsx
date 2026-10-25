import { diaryToday, shiftDiaryDate, type DiaryDateProps } from "../domain/diary";
import { BookOpen, ChefHat, ChevronLeft, ChevronRight, Library, Plus, UtensilsCrossed } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { MealEntry, RecipeVersion, MealType } from "../domain/types";
import { useAppStore } from "../store/appStore";
import { useFoodPicker } from "../store/foodPicker";
import { Modal } from "../components/Modal";
import { useConfirmedAction } from "../components/useConfirmedAction";
import type { ActionResult } from "../store/appStore";
import { FoodLibraryModal } from "../components/FoodLibraryModal";
import { MealCorrectionModal } from "../components/MealCorrectionModal";
import { RecipeEditor } from "../components/RecipeEditor";
import { RecipeManagerDrawer } from "../components/RecipeManagerDrawer";
import { RecipeMealDraftModal } from "../components/RecipeMealDraftModal";
import { latestRecipes } from "../domain/recipes";
import { recipeShortage } from "../domain/pantry";
import { MealDiaryTable } from "../components/MealDiaryTable";
import { CopyMealModal } from "../components/CopyMealModal";
import { mealCopySource, mealLabels, mealTypes, frequentFoods, type FrequentFood, type MealCopySource } from "../domain/meals";
import { readDiaryShowSodium, writeDiaryShowSodium } from "../domain/preferences";
import { useEnergyUnit } from "../hooks/useEnergyUnit";
import { energyUnitLabels } from "../domain/energyDisplay";
import { calculateFoodPortion, foodUnitLabels } from "../domain/foodLibrary";
import { nutrientText } from "../domain/nutritionDisplay";

export function FoodPage({ date = diaryToday(), onDateChange, autoOpenMeal, autoOpenMealType, onAutoOpenConsumed, goTo }: DiaryDateProps & { autoOpenMeal?: boolean; autoOpenMealType?: MealType; onAutoOpenConsumed?: () => void; goTo?: (page: string) => void } = {}) {
  const [correction,setCorrection]=useState<{meal:MealEntry;mode:"edit"|"void"}|null>(null);
  const [recipeEditor,setRecipeEditor]=useState<RecipeVersion|"new"|null>(null);
  const [selectedRecipeId,setSelectedRecipeId]=useState("");
  const [showHistory,setShowHistory]=useState(false);
  const [copyRecipe,setCopyRecipe]=useState(false);
  const [recipeDrawer,setRecipeDrawer]=useState(false);
  const [recipeMealOpen,setRecipeMealOpen]=useState(false);
  const [libraryOpen,setLibraryOpen]=useState(false);
  const [showSodium,setShowSodium]=useState(readDiaryShowSodium);
  const [mealOpen, setMealOpen] = useState(false);
  const [copyTarget, setCopyTarget] = useState<{ type: MealType; source: MealCopySource } | null>(null);
  const [manualMeal, setManualMeal] = useState(false);
  const [initialMealType, setInitialMealType] = useState<MealType>("breakfast");
  const [preselectFoodId, setPreselectFoodId] = useState<string | null>(null);
  function openMeal(type: MealType = "breakfast") { setManualMeal(false); setInitialMealType(type); setPreselectFoodId(null); setMealOpen(true); }
  // 今日页「吃了什么」直达：按带来的餐次打开，而不是固定早餐；打开后立刻回报，避免重复触发。
  useEffect(() => {
    if (!autoOpenMeal) return;
    if (autoOpenMealType) setInitialMealType(autoOpenMealType);
    setMealOpen(true);
    onAutoOpenConsumed?.();
  }, [autoOpenMeal, autoOpenMealType, onAutoOpenConsumed]);
  // 食材库页建档归来的回程票：自动打开选择器并预选新食物，篮子仍在跨页 store。
  useEffect(() => {
    const picker = useFoodPicker.getState();
    if (picker.returnTicket) {
      const foodId = picker.returnTicket;
      picker.setReturnTicket(null);
      setPreselectFoodId(foodId);
      setManualMeal(false);
      setMealOpen(true);
    }
  }, []);
  function toggleSodium(visible: boolean) { setShowSodium(visible); writeDiaryShowSodium(visible); }
  const [energyUnit] = useEnergyUnit();
  const meals = useAppStore((state) => state.meals);
  const recipes = useAppStore((state) => state.recipes);
  const foodDefinitions = useAppStore((state) => state.foodDefinitions);
  const foodDefinitionVersions = useAppStore((state) => state.foodDefinitionVersions);
  const addMeal = useAppStore((state) => state.addMeal);
  const today = date;
  // 常吃榜：近 30 天频次 Top 8；一键按上次份量直接进待确认篮子（目标：常吃饭 3 次点击记完）。
  const frequent = useMemo(
    () => frequentFoods(meals, foodDefinitions, foodDefinitionVersions, today),
    [meals, foodDefinitions, foodDefinitionVersions, today],
  );
  function quickAddFrequent(food: FrequentFood) {
    const last = food.lastPortion;
    if (last) {
      try {
        const preview = calculateFoodPortion(food.version, last.quantity, last.unit);
        useFoodPicker.getState().setBasket((items) => [
          ...items,
          { foodVersionId: food.version.id, quantity: last.quantity, unit: last.unit, name: food.definition.name, facts: preview.nutrition },
        ]);
        setManualMeal(false);
        setPreselectFoodId(null);
        setMealOpen(true);
        return;
      } catch { /* 换算失败（如上次单位已不可用）退回预选路径，不猜数值 */ }
    }
    setManualMeal(false);
    setPreselectFoodId(food.definition.id);
    setMealOpen(true);
  }
  // 每个餐次能照搬哪一天：只在目标日期之前、同餐次、仍然有效的记录里取最近一天。
  const copySources = useMemo(
    () =>
      Object.fromEntries(mealTypes.map((type) => [type, mealCopySource(meals, type, today)])) as Partial<
        Record<MealType, MealCopySource | null>
      >,
    [meals, today],
  );
  const pantryItems = useAppStore((state) => state.pantryItems);
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
    <div className="page food-page" style={{ display: "flex", flexDirection: "column", gap: 13, flex: 1, minHeight: 0 }}>
      <header className="ui-page-head">
        <div>
          <div className="date">{today === diaryToday() ? "实际摄入 · 今天" : `实际摄入 · ${today}`}</div>
          <h1>饮食日记</h1>
        </div>
        <div className="actions" style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div className="ui-datestrip">
            <button className="ui-navbtn" aria-label="前一天" onClick={() => onDateChange?.(shiftDiaryDate(date, -1))}><ChevronLeft size={15} /></button>
            <input type="date" aria-label="查看日期" value={date} onChange={(event) => event.target.value && onDateChange?.(event.target.value)} style={{ all: "unset", cursor: "pointer", font: "inherit", color: "var(--ui-ink-2)" }} />
            <button className="ui-navbtn" aria-label="后一天" disabled={date >= diaryToday()} onClick={() => onDateChange?.(shiftDiaryDate(date, 1))}><ChevronRight size={15} /></button>
          </div>
          <button className="ui-btn food-recipe-btn" aria-label="打开菜谱管理" onClick={() => setRecipeDrawer(true)}>
            <ChefHat size={15} /> <span className="food-recipe-btn-text">菜谱</span>
          </button>
          <button className="ui-btn" onClick={() => (goTo ? goTo("library") : setLibraryOpen(true))}><Library size={15} /> 食材库</button>
          <button className="ui-btn primary" onClick={() => openMeal()}><Plus size={15} /> 添加食物</button>
        </div>
      </header>

      {frequent.length > 0 && (
        <section className="ui-card" aria-label="常吃食物" style={{ padding: "10px 16px", display: "flex", alignItems: "center", gap: 14 }}>
          <div className="ui-panel-head" style={{ marginBottom: 0 }}><h2 style={{ fontSize: 12 }}>常吃</h2></div>
          <div className="ui-chips">
            {frequent.map((food) => (
              <button
                key={food.definition.id}
                type="button"
                className="ui-chip"
                title={food.lastPortion ? `按上次 ${food.lastPortion.quantity} ${foodUnitLabels[food.lastPortion.unit]} 加入篮子` : "打开选择器选择份量"}
                onClick={() => quickAddFrequent(food)}
              >
                <b>{food.definition.name}</b>
                {food.lastPortion && <span>上次 {food.lastPortion.quantity}{foodUnitLabels[food.lastPortion.unit]}</span>}
              </button>
            ))}
          </div>
        </section>
      )}
      <p className="ui-chart-foot" style={{ marginTop: 0, paddingTop: 0 }}>补录或新增餐食会把该日重新标为待核对，请在日报再次确认完成。</p>
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
      {libraryOpen && <FoodLibraryModal catalogOnly onClose={() => setLibraryOpen(false)} onManual={() => undefined} />}

      {correction&&<MealCorrectionModal meal={correction.meal} mode={correction.mode} onClose={()=>setCorrection(null)} onSaved={onDateChange}/>}
      {copyTarget && <CopyMealModal date={today} type={copyTarget.type} source={copyTarget.source} onClose={() => setCopyTarget(null)} />}
      {recipeEditor&&<RecipeEditor copyMode={copyRecipe} recipe={recipeEditor==="new"?undefined:recipeEditor} onClose={()=>setRecipeEditor(null)} onSaved={setSelectedRecipeId}/>}
      {meals.some(m=>m.date===date&&m.status&&m.status!=="active")&&<details className="card meal-correction-history"><summary>查看所选日修订／作废的原始记录</summary>{meals.filter(m=>m.date===date&&m.status&&m.status!=="active").map(m=><article key={m.id}><strong>{m.name} · {m.status==="void"?"已作废":"已修订"}</strong><p>{m.date} · {m.amountLabel} · 原始营养 {nutrientText(m.nutrition, "calories", energyUnit)} {energyUnitLabels[energyUnit]}（参考规格，非重新入账）</p><p>原因：{m.correctionReason}；原记录 ID：{m.id}</p></article>)}</details>}
      {mealOpen && <><div hidden={manualMeal}><FoodLibraryModal initialType={initialMealType} initialDate={date} onRecorded={onDateChange} preselectFoodId={preselectFoodId ?? undefined} onClose={() => { setMealOpen(false); setPreselectFoodId(null); }} onManual={() => setManualMeal(true)} onOpenEditor={goTo ? (target) => { useFoodPicker.getState().setEditorTarget(target); goTo("library"); } : undefined} /></div>{manualMeal && <MealModal initialType={initialMealType} initialDate={date} onBack={() => setManualMeal(false)} onRecorded={onDateChange} onClose={() => setMealOpen(false)} onSave={addMeal}/>}</>}
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
