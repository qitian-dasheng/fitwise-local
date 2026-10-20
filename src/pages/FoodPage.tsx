import { format } from "date-fns";
import { AlertTriangle, ChefHat, Plus, ShieldCheck, Trash2, Utensils } from "lucide-react";
import { useState } from "react";
import { summarizeMeals } from "../domain/calculations";
import type { MealType } from "../domain/types";
import { useAppStore } from "../store/appStore";
import { Modal } from "../components/Modal";
import { PageHeader } from "../components/PageHeader";
import { useConfirmedAction } from "../components/useConfirmedAction";
import type { ActionResult } from "../store/appStore";

const mealLabels: Record<MealType, string> = { breakfast: "早餐", lunch: "午餐", dinner: "晚餐", snack: "加餐" };

export function FoodPage() {
  const [mealOpen, setMealOpen] = useState(false);
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
  const consumptionEvents = useAppStore((state) => state.consumptionEvents);
  const wasteEvents = useAppStore((state) => state.wasteEvents);
  const addMeal = useAppStore((state) => state.addMeal);
  const prepareRecipe = useAppStore((state) => state.prepareRecipe);
  const consumeBatch = useAppStore((state) => state.consumeBatch);
  const discardBatchRemainder = useAppStore((state) => state.discardBatchRemainder);
  const today = format(new Date(), "yyyy-MM-dd");
  const todayMeals = meals.filter((item) => item.date === today);
  const total = summarizeMeals(todayMeals);
  const recipe = recipes[0];
  const activeBatches = batches.filter((item) => item.status === "open" && item.remainingRatio > 0);
  const todayBatches = batches.filter((item) => item.date === today);
  const selectedBatch = batches.find((item) => item.id === batchOpen);

  return (
    <div className="page">
      <PageHeader eyebrow="实际摄入" title="饮食日记" description="计划只是计划，只有确认吃下的食物才会进入趋势。" action={<button className="button primary" onClick={() => setMealOpen(true)}><Plus size={17} /> 添加食物</button>} />
      {statusMessage && <div className="settings-notice card" role="status">{statusMessage}</div>}
      <div className="metric-row">
        <Metric label="今日热量" value={`${Math.round(total.totals.calories)} kcal`} note={`覆盖率 ${total.coverage.calories}%`} />
        <Metric label="蛋白质" value={`${Math.round(total.totals.protein)} g`} note="目标约 100 g" />
        <Metric label="膳食纤维" value={`${Math.round(total.totals.fiber)} g`} note="提醒线 25 g" />
        <Metric label="已确认批次" value={`${batches.filter((item) => item.date === today).length} 个`} note="原料与进食分开" />
      </div>

      <div className="two-column">
        <section className="card">
          <div className="card-heading compact"><div><p className="eyebrow">今日明细</p><h2>按餐次记录</h2></div><span className="status-pill neutral">{todayMeals.length} 条</span></div>
          <div className="timeline">
            {(["breakfast", "lunch", "dinner", "snack"] as MealType[]).map((type) => {
              const items = todayMeals.filter((item) => item.type === type);
              return (
                <div className="timeline-group" key={type}>
                  <div className="timeline-label"><span>{mealLabels[type]}</span><b>{Math.round(summarizeMeals(items).totals.calories)} kcal</b></div>
                  {items.length ? items.map((item) => (
                    <div className="food-entry" key={item.id}>
                      <div className="meal-icon"><Utensils size={16} /></div>
                      <div><strong>{item.name}</strong><span>{item.amountLabel} · {item.confidence === "high" ? "已确认" : "估算"}</span></div>
                      <b>{Math.round((item.nutrition.calories.value ?? 0) * item.consumedRatio)}</b>
                    </div>
                  )) : <button className="empty-entry" onClick={() => setMealOpen(true)}><Plus size={15} /> 添加{mealLabels[type]}</button>}
                </div>
              );
            })}
          </div>
        </section>

        <section className="stack">
          <article className="card recipe-card">
            <div className="recipe-visual"><ChefHat size={32} /></div>
            <p className="eyebrow">标准菜谱 · v{recipe.version}</p>
            <h2>{recipe.name}</h2>
            <p>制作、实际进食与丢弃分别记账。确认制作只扣原料，不会提前计入饮食。</p>
            <div className="recipe-macros"><span><b>883</b> kcal</span><span><b>119.6</b> g 蛋白质</span><span><b>30</b> 分钟</span></div>
            <ul className="ingredient-list">{recipe.ingredients.map((item) => <li key={item.foodId}><span>{item.name}</span><b>{item.amount} {item.unit}</b></li>)}</ul>
            <button className="button primary wide" disabled={busyAction} onClick={() => { setMessage(""); setCookCommandId(crypto.randomUUID()); setCookOpen(true); }}>确认今日制作</button>
          </article>
          {activeBatches.map((batch) => <article className="card batch-card" key={batch.id}>
            <div className="card-heading compact"><div><p className="eyebrow">熟食批次 · 待处理</p><h3>{recipe.name}</h3></div><span className="status-pill warning">剩余 {Math.round(batch.remainingRatio * 100)}%</span></div>
            <div className="batch-progress"><i style={{ width: `${batch.remainingRatio * 100}%` }}/></div>
            <p>已吃 {Math.round(batch.consumedRatio * 100)}%，已丢弃 {Math.round(batch.wastedRatio * 100)}%。保留剩余时无需现在处理，可在下一餐继续记录。</p>
            <div className="button-row"><button className="button primary small" disabled={busyAction} onClick={() => { setConsumeRatio(String(Math.round(Math.min(.5, batch.remainingRatio) * 100))); setConsumeCommandId(crypto.randomUUID()); setBatchOpen(batch.id); setMessage(""); }}>记录实际进食</button><button className="button danger small" disabled={busyAction} onClick={async () => { if (!confirm(`确认将剩余 ${Math.round(batch.remainingRatio * 100)}% 记为熟食丢弃？`)) return; const commandId = discardCommandIds[batch.id] ?? crypto.randomUUID(); setDiscardCommandIds((current) => ({ ...current, [batch.id]: commandId })); setBusyAction(true); const result = await discardBatchRemainder(batch.id, "discarded", commandId); setBusyAction(false); if (result.error) { setStatusMessage(result.error); } else { setStatusMessage("剩余熟食已记入浪费记录。"); setDiscardCommandIds((current) => { const next = { ...current }; delete next[batch.id]; return next; }); } }}><Trash2 size={14}/> {busyAction ? "处理中…" : "丢弃剩余"}</button></div>
          </article>)}
          <article className="card validation-card"><ShieldCheck size={22} /><div><strong>营养值不会把空白当成零</strong><p>首次商品会校验千焦/千卡、每份/每百克和净含量。</p></div></article>
        </section>
      </div>

      {todayBatches.length > 0 && <section className="card batch-history"><div className="card-heading compact"><div><p className="eyebrow">原料、进食、浪费分账</p><h2>今日熟食批次</h2></div><span className="status-pill neutral">{todayBatches.length} 批</span></div>{todayBatches.map((batch) => { const consumed = consumptionEvents.filter((item) => item.batchId === batch.id); const waste = wasteEvents.filter((item) => item.batchId === batch.id); return <div className="batch-history-row" key={batch.id}><div><strong>{recipes.find((item) => item.id === batch.recipeVersionId)?.name ?? "未知菜谱"}</strong><span>{consumed.length ? consumed.map((item) => `${mealLabels[item.mealType]} ${Math.round(item.ratio * 100)}%`).join(" · ") : "尚未记录进食"}</span></div><div><small>已吃</small><b>{Math.round(batch.consumedRatio * 100)}%</b></div><div><small>保留</small><b>{Math.round(batch.remainingRatio * 100)}%</b></div><div><small>丢弃</small><b>{Math.round(batch.wastedRatio * 100)}%</b></div><span className={`status-pill ${batch.status === "open" ? "warning" : "success"}`}>{batch.status === "open" ? "仍有剩余" : waste.length ? "已结束 · 含浪费" : "已吃完"}</span></div>; })}</section>}

      {mealOpen && <MealModal onClose={() => setMealOpen(false)} onSave={addMeal} />}
      {cookOpen && (
        <Modal title="确认制作整锅菜" onClose={() => setCookOpen(false)}>
          <div className="form">
            <div className="ratio-summary"><ChefHat size={20} /><div><strong>这一步只确认制作完成</strong><span>四种原料会按 FEFO 扣减一次；午餐、晚餐和剩余熟食稍后分别记录。</span></div></div>
            {message && <div className="alert"><AlertTriangle size={18} />{message}</div>}
            <button className="button primary wide" disabled={busyAction} onClick={async () => { setBusyAction(true); const result = await prepareRecipe(recipe.id, cookCommandId || crypto.randomUUID()); setBusyAction(false); if (result.shortage.length) setMessage(result.shortage.join("；")); else { setCookOpen(false); setStatusMessage("制作批次已建立，原料已扣减；尚未计入任何饮食摄入。"); } }}>{busyAction ? "正在提交…" : "确认制作并扣减原料"}</button>
          </div>
        </Modal>
      )}
      {selectedBatch && (
        <Modal title="记录这个批次的实际进食" onClose={() => setBatchOpen(null)}>
          <form className="form" onSubmit={async (event) => { event.preventDefault(); const ratio = Number(consumeRatio) / 100; setBusyAction(true); const result = await consumeBatch({ batchId: selectedBatch.id, mealType: consumeType, ratio, ratioIsEstimated: true, commandId: consumeCommandId || crypto.randomUUID() }); setBusyAction(false); if (result.error) setMessage(result.error); else { setBatchOpen(null); setStatusMessage(`已把整锅的 ${Math.round(ratio * 100)}% 记入${mealLabels[consumeType]}；其余继续保留在熟食批次中。`); } }}>
            <label><span>计入餐次</span><select value={consumeType} onChange={(event) => setConsumeType(event.target.value as MealType)}><option value="lunch">午餐</option><option value="dinner">晚餐</option><option value="breakfast">早餐</option><option value="snack">加餐</option></select></label>
            <label><span>占整锅比例（当前最多 {Math.round(selectedBatch.remainingRatio * 100)}%）</span><input type="number" min="1" max={Math.round(selectedBatch.remainingRatio * 10000) / 100} step="1" required value={consumeRatio} onChange={(event) => setConsumeRatio(event.target.value)}/></label>
            <div className="ratio-options">{[25, 33, 50, Math.round(selectedBatch.remainingRatio * 100)].filter((value, index, values) => value > 0 && value <= selectedBatch.remainingRatio * 100 + .01 && values.indexOf(value) === index).map((value) => <button type="button" key={value} className={Number(consumeRatio) === value ? "active" : ""} onClick={() => setConsumeRatio(String(value))}>{value === Math.round(selectedBatch.remainingRatio * 100) ? `全部剩余 ${value}%` : `${value}%`}</button>)}</div>
            <p className="form-hint">这里记录的是整锅比例，不是假定午晚餐各一半。当前按目测估算，未来可升级为熟重称量。</p>
            {message && <div className="alert"><AlertTriangle size={18}/>{message}</div>}
            <button className="button primary wide" type="submit" disabled={busyAction}>{busyAction ? "正在提交…" : "确认写入这一餐"}</button>
          </form>
        </Modal>
      )}
    </div>
  );
}

function Metric({ label, value, note }: { label: string; value: string; note: string }) {
  return <article className="metric-card"><span>{label}</span><strong>{value}</strong><small>{note}</small></article>;
}

function MealModal({ onClose, onSave }: { onClose: () => void; onSave: (input: { name: string; type: MealType; amountLabel: string; calories: number; protein: number; fiber?: number }, commandId?: string) => Promise<ActionResult> }) {
  const [form, setForm] = useState({ name: "", type: "breakfast" as MealType, amountLabel: "", calories: "", protein: "", fiber: "" });
  const action = useConfirmedAction();
  return (
    <Modal title="添加确认过的食物" onClose={() => { if (!action.busy) onClose(); }}>
      <form className="form" onSubmit={async (event) => { event.preventDefault(); const input = { ...form, calories: Number(form.calories), protein: Number(form.protein), fiber: form.fiber ? Number(form.fiber) : undefined }; const result = await action.run(JSON.stringify(input), (id) => onSave(input, id)); if (!result.error) onClose(); }}>
        <label><span>餐次</span><select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value as MealType })}>{Object.entries(mealLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
        <label><span>食物或菜品名称</span><input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="例如 鸡蛋、燕麦与无糖酸奶" /></label>
        <label><span>份量说明</span><input required value={form.amountLabel} onChange={(event) => setForm({ ...form, amountLabel: event.target.value })} placeholder="例如 鸡蛋3个、燕麦50克" /></label>
        <div className="form-grid"><label><span>热量 kcal</span><input required type="number" min="0" value={form.calories} onChange={(event) => setForm({ ...form, calories: event.target.value })} /></label><label><span>蛋白质 g</span><input required type="number" min="0" step="0.1" value={form.protein} onChange={(event) => setForm({ ...form, protein: event.target.value })} /></label></div>
        <label><span>膳食纤维 g（可留空，留空不等于 0）</span><input type="number" min="0" step="0.1" value={form.fiber} onChange={(event) => setForm({ ...form, fiber: event.target.value })} /></label>
        {action.message && <p className="form-error" role="alert">{action.message}</p>}
        <button className="button primary wide" type="submit" disabled={action.busy}>{action.busy ? "正在保存…" : "确认写入饮食日记"}</button>
      </form>
    </Modal>
  );
}
