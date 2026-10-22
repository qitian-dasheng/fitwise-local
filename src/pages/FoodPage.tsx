import { diaryToday, ratioPercent, type DiaryDateProps } from "../domain/diary";
import { DiaryDateControl } from "../components/DiaryDateControl";
import { AlertTriangle, BookOpen, ChefHat, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
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
import { latestRecipes } from "../domain/recipes";
import { BatchHistory } from "../components/BatchHistory";
import { MealDiaryTable } from "../components/MealDiaryTable";
import { CopyMealModal } from "../components/CopyMealModal";
import { mealCopySource, mealLabels, mealTypes, type MealCopySource } from "../domain/meals";
import { readDiaryShowSodium, writeDiaryShowSodium } from "../domain/preferences";

export function FoodPage({ date = diaryToday(), onDateChange }: DiaryDateProps = {}) {
  const [correction,setCorrection]=useState<{meal:MealEntry;mode:"edit"|"void"}|null>(null);
  const [recipeEditor,setRecipeEditor]=useState<RecipeVersion|"new"|null>(null);
  const [selectedRecipeId,setSelectedRecipeId]=useState("");
  const [showHistory,setShowHistory]=useState(false);
  const [copyRecipe,setCopyRecipe]=useState(false);
  const [recipeDrawer,setRecipeDrawer]=useState(false);
  const [showSodium,setShowSodium]=useState(readDiaryShowSodium);
  const [mealOpen, setMealOpen] = useState(false);
  const [copyTarget, setCopyTarget] = useState<{ type: MealType; source: MealCopySource } | null>(null);
  const [manualMeal, setManualMeal] = useState(false);
  const [initialMealType, setInitialMealType] = useState<MealType>("breakfast");
  function openMeal(type: MealType = "breakfast") { setManualMeal(false); setInitialMealType(type); setMealOpen(true); }
  function toggleSodium(visible: boolean) { setShowSodium(visible); writeDiaryShowSodium(visible); }
  const [cookOpen, setCookOpen] = useState(false);
  const [batchOpen, setBatchOpen] = useState<string | null>(null);
  const [consumeRatio, setConsumeRatio] = useState("50");
  const [consumeType, setConsumeType] = useState<MealType>("lunch");
  const [message, setMessage] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [busyAction, setBusyAction] = useState(false);
  const [cookCommandId, setCookCommandId] = useState("");
  const [consumeCommandId, setConsumeCommandId] = useState("");
  const [discardCommandIds, setDiscardCommandIds] = useState<Record<string, string>>({});
  const meals = useAppStore((state) => state.meals);
  const recipes = useAppStore((state) => state.recipes);
  const batches = useAppStore((state) => state.batches);
  const addMeal = useAppStore((state) => state.addMeal);
  const prepareRecipe = useAppStore((state) => state.prepareRecipe);
  const consumeBatch = useAppStore((state) => state.consumeBatch);
  const discardBatchRemainder = useAppStore((state) => state.discardBatchRemainder);
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
  const activeBatches = batches.filter((item) => item.status === "open" && item.remainingRatio > 0);
  const selectedBatch = batches.find((item) => item.id === batchOpen);
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
      {statusMessage && <div className="settings-notice card" role="status">{statusMessage}</div>}
      <MealDiaryTable
        date={today}
        entries={meals}
        showSodium={showSodium}
        onSodiumChange={toggleSodium}
        batchCount={batches.filter((item) => item.date === today && item.status !== "void").length}
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
            <button className="button secondary small" onClick={() => setRecipeDrawer(true)}><BookOpen size={15} /> 管理菜谱</button>
          </div>

          {recipe ? (
            <div className="kitchen-body">
              <div className="kitchen-top">
                <div className="recipe-visual"><ChefHat size={30} /></div>
                <div className="kitchen-meta">
                  <p className="eyebrow">v{recipe.version} · {recipe.totalMinutes} 分钟</p>
                  <h3>{recipe.name}</h3>
                  <p>制作、实际进食与丢弃分别记账。确认制作只扣原料，不会提前计入饮食。</p>
                </div>
              </div>
              {!latest.some(r=>r.id===recipe.id)&&<p className="library-notice">正在复用历史 v{recipe.version}：制作沿用原版本的原料和营养，不会替换为最新版。</p>}
              <div className="recipe-macros"><span><b>{recipe.nutrition.calories.value ?? "未知"}</b> kcal</span><span><b>{recipe.nutrition.protein.value ?? "未知"}</b> g 蛋白质</span><span><b>{recipe.totalMinutes}</b> 分钟</span></div>
              <ul className="ingredient-list">{recipe.ingredients.map((item) => <li key={item.foodId}><span>{item.name}</span><b>{item.amount} {item.unit}</b></li>)}</ul>
              <button className="button primary wide" disabled={busyAction || date !== diaryToday()} onClick={() => { setMessage(""); setCookCommandId(crypto.randomUUID()); setCookOpen(true); }}>{date === diaryToday() ? "确认今日制作" : "回到今天后确认实际制作"}</button>
            </div>
          ) : (
            <div className="kitchen-empty">
              <ChefHat size={26} />
              <strong>暂无标准菜谱</strong>
              <p>仍可通过食材库或仅记录本次入口记餐；固定搭配建议先建成菜谱，之后一锅两吃只需两次点击。</p>
              <button className="button secondary small" onClick={() => openRecipeEditor("new", false)}>新建第一个菜谱</button>
            </div>
          )}

          <p className="kitchen-footnote"><ShieldCheck size={15} /><span>营养值不会把空白当成零：首次商品会校验千焦／千卡、每份／每百克和净含量。</span></p>
        </section>

        <section className="batches-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">熟食批次</p>
              <h2>待处理</h2>
            </div>
            <span className={`status-pill ${activeBatches.length ? "warning" : "neutral"}`}>{activeBatches.length} 个</span>
          </div>

          {activeBatches.length === 0 ? (
            <article className="batches-empty">
              <ChefHat size={24} />
              <strong>没有待处理的批次</strong>
              <p>确认制作后，剩余熟食会在这里等您记录实际进食或丢弃；处理完自动归档到下方台账。</p>
            </article>
          ) : activeBatches.map((batch) => <article className="card batch-card" key={batch.id}>
            <div className="card-heading compact"><div><p className="eyebrow">制作于 {batch.date} · 待处理</p><h3>{recipes.find(item => item.id === batch.recipeVersionId)?.name ?? "菜谱版本缺失"}</h3></div><span className="status-pill warning">剩余 {ratioPercent(batch.remainingRatio)}%</span></div>
            <div className="batch-progress"><i style={{ width: `${batch.remainingRatio * 100}%` }}/></div>
            <p>已吃 {ratioPercent(batch.consumedRatio)}%，已丢弃 {ratioPercent(batch.wastedRatio)}%。跨日保存前请自行核对冷藏条件与食材状态；系统不判断是否安全。</p>
            <div className="button-row"><button className="button primary small" disabled={busyAction || date < batch.date} onClick={() => { setConsumeRatio(String(ratioPercent(Math.min(.5, batch.remainingRatio)))); setConsumeCommandId(crypto.randomUUID()); setBatchOpen(batch.id); setMessage(""); }}>记录实际进食</button><button className="button danger small" disabled={busyAction} onClick={async () => { if (!confirm(`确认将剩余 ${ratioPercent(batch.remainingRatio)}% 记为熟食丢弃？`)) return; const commandId = discardCommandIds[batch.id] ?? crypto.randomUUID(); setDiscardCommandIds((current) => ({ ...current, [batch.id]: commandId })); setBusyAction(true); const result = await discardBatchRemainder(batch.id, "discarded", commandId); setBusyAction(false); if (result.error) { setStatusMessage(result.error); } else { setStatusMessage("剩余熟食已记入浪费记录。"); setDiscardCommandIds((current) => { const next = { ...current }; delete next[batch.id]; return next; }); } }}><Trash2 size={14}/> {busyAction ? "处理中…" : "丢弃剩余"}</button></div>
          </article>)}
        </section>
      </div>

      <BatchHistory date={date} />

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
        onClose={() => setRecipeDrawer(false)}
      />}

      {correction&&<MealCorrectionModal meal={correction.meal} mode={correction.mode} onClose={()=>setCorrection(null)} onSaved={onDateChange}/>}
      {copyTarget && <CopyMealModal date={today} type={copyTarget.type} source={copyTarget.source} onClose={() => setCopyTarget(null)} />}
      {recipeEditor&&<RecipeEditor copyMode={copyRecipe} recipe={recipeEditor==="new"?undefined:recipeEditor} onClose={()=>setRecipeEditor(null)} onSaved={setSelectedRecipeId}/>}
      {meals.some(m=>m.date===date&&m.status&&m.status!=="active")&&<details className="card meal-correction-history"><summary>查看所选日修订／作废的原始记录</summary>{meals.filter(m=>m.date===date&&m.status&&m.status!=="active").map(m=><article key={m.id}><strong>{m.name} · {m.status==="void"?"已作废":"已修订"}</strong><p>{m.date} · {m.amountLabel} · 原始营养 {m.nutrition.calories.state==="unknown"?"未知":m.nutrition.calories.value} kcal（参考规格，非重新入账）</p><p>原因：{m.correctionReason}；原记录 ID：{m.id}</p></article>)}</details>}
      {mealOpen && <><div hidden={manualMeal}><FoodLibraryModal initialType={initialMealType} initialDate={date} onRecorded={onDateChange} onClose={() => setMealOpen(false)} onManual={() => setManualMeal(true)} /></div>{manualMeal && <MealModal initialType={initialMealType} initialDate={date} onBack={() => setManualMeal(false)} onRecorded={onDateChange} onClose={() => setMealOpen(false)} onSave={addMeal}/>}</>}
      {cookOpen && recipe && (
        <Modal title="确认制作整锅菜" onClose={() => { if (!busyAction) setCookOpen(false); }}>
          <div className="form">
            <div className="ratio-summary"><ChefHat size={20} /><div><strong>这一步只确认制作完成</strong><span>当前配方的原料会按 FEFO 扣减一次；午餐、晚餐和剩余熟食稍后分别记录。</span></div></div>
            {message && <div className="alert"><AlertTriangle size={18} />{message}</div>}
            <button className="button primary wide" disabled={busyAction} onClick={async () => { setBusyAction(true); const result = await prepareRecipe(recipe.id, cookCommandId || crypto.randomUUID()); setBusyAction(false); if (result.shortage.length) setMessage(result.shortage.join("；")); else { setCookOpen(false); setStatusMessage("制作批次已建立，原料已扣减；尚未计入任何饮食摄入。"); } }}>{busyAction ? "正在提交…" : "确认制作并扣减原料"}</button>
          </div>
        </Modal>
      )}
      {selectedBatch && (
        <Modal title="记录这个批次的实际进食" onClose={() => { if (!busyAction) setBatchOpen(null); }}>
          <form className="form" onSubmit={async (event) => { event.preventDefault(); const ratio = Number(consumeRatio) / 100; setBusyAction(true); const result = await consumeBatch({ batchId: selectedBatch.id, mealType: consumeType, ratio, ratioIsEstimated: true, date, commandId: consumeCommandId || crypto.randomUUID() }); setBusyAction(false); if (result.error) setMessage(result.error); else { setBatchOpen(null); setStatusMessage(`已把整锅的 ${ratioPercent(ratio)}% 记入${mealLabels[consumeType]}；其余继续保留在熟食批次中。`); } }}>
            <fieldset className="library-fields" disabled={busyAction}>
            <p className="form-hint">进食日期：{date}。如需补录其他日期，请先关闭窗口并切换记录日期。</p>
            <label><span>计入餐次</span><select value={consumeType} onChange={(event) => setConsumeType(event.target.value as MealType)}><option value="lunch">午餐</option><option value="dinner">晚餐</option><option value="breakfast">早餐</option><option value="snack">加餐</option></select></label>
            <label><span>占整锅比例（当前最多 {ratioPercent(selectedBatch.remainingRatio)}%）</span><input type="number" min="0.01" max={ratioPercent(selectedBatch.remainingRatio)} step="0.01" required value={consumeRatio} onChange={(event) => setConsumeRatio(event.target.value)}/></label>
            <div className="ratio-options">{[25, 33, 50, ratioPercent(selectedBatch.remainingRatio)].filter((value, index, values) => value > 0 && value <= selectedBatch.remainingRatio * 100 + 1e-8 && values.indexOf(value) === index).map((value) => <button type="button" key={value} className={Number(consumeRatio) === value ? "active" : ""} onClick={() => setConsumeRatio(String(value))}>{value === ratioPercent(selectedBatch.remainingRatio) ? `全部剩余 ${value}%` : `${value}%`}</button>)}</div>
            <p className="form-hint">这里记录的是整锅比例，不是假定午晚餐各一半。当前按目测估算，未来可升级为熟重称量。</p>
            {message && <div className="alert"><AlertTriangle size={18}/>{message}</div>}
            <button className="button primary wide" type="submit" disabled={busyAction}>{busyAction ? "正在提交…" : "确认写入这一餐"}</button>
            </fieldset>
          </form>
        </Modal>
      )}
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
