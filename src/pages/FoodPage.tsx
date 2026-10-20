import { format } from "date-fns";
import { AlertTriangle, CheckCircle2, ChefHat, Plus, ShieldCheck, Utensils } from "lucide-react";
import { useState } from "react";
import { summarizeMeals } from "../domain/calculations";
import type { MealType } from "../domain/types";
import { useAppStore } from "../store/appStore";
import { Modal } from "../components/Modal";
import { PageHeader } from "../components/PageHeader";

const mealLabels: Record<MealType, string> = { breakfast: "早餐", lunch: "午餐", dinner: "晚餐", snack: "加餐" };

export function FoodPage() {
  const [mealOpen, setMealOpen] = useState(false);
  const [cookOpen, setCookOpen] = useState(false);
  const [cookRatio, setCookRatio] = useState(1);
  const [message, setMessage] = useState("");
  const meals = useAppStore((state) => state.meals);
  const recipes = useAppStore((state) => state.recipes);
  const batches = useAppStore((state) => state.batches);
  const addMeal = useAppStore((state) => state.addMeal);
  const cookRecipe = useAppStore((state) => state.cookRecipe);
  const today = format(new Date(), "yyyy-MM-dd");
  const todayMeals = meals.filter((item) => item.date === today);
  const total = summarizeMeals(todayMeals);
  const recipe = recipes[0];

  return (
    <div className="page">
      <PageHeader eyebrow="实际摄入" title="饮食日记" description="计划只是计划，只有确认吃下的食物才会进入趋势。" action={<button className="button primary" onClick={() => setMealOpen(true)}><Plus size={17} /> 添加食物</button>} />
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
            <p>整锅供午晚餐共享。确认制作后扣除全部原料，只按实际吃掉比例计算摄入。</p>
            <div className="recipe-macros"><span><b>883</b> kcal</span><span><b>119.6</b> g 蛋白质</span><span><b>30</b> 分钟</span></div>
            <ul className="ingredient-list">{recipe.ingredients.map((item) => <li key={item.foodId}><span>{item.name}</span><b>{item.amount} {item.unit}</b></li>)}</ul>
            <button className="button primary wide" onClick={() => { setMessage(""); setCookOpen(true); }}>确认今日制作</button>
          </article>
          <article className="card validation-card"><ShieldCheck size={22} /><div><strong>营养值不会把空白当成零</strong><p>首次商品会校验千焦/千卡、每份/每百克和净含量。</p></div></article>
        </section>
      </div>

      {mealOpen && <MealModal onClose={() => setMealOpen(false)} onSave={(input) => { addMeal(input); setMealOpen(false); }} />}
      {cookOpen && (
        <Modal title="确认整锅的实际去向" onClose={() => setCookOpen(false)}>
          <div className="form">
            <div className="ratio-options">
              {[1, 0.75, 0.67, 0.5].map((ratio) => <button key={ratio} className={cookRatio === ratio ? "active" : ""} onClick={() => setCookRatio(ratio)}>{ratio === 1 ? "全部吃完" : `剩约 ${Math.round((1 - ratio) * 100)}%`}</button>)}
            </div>
            <div className="ratio-summary"><CheckCircle2 size={20} /><div><strong>摄入 {Math.round(cookRatio * 100)}%</strong><span>库存仍会扣除整锅原料，剩余 {Math.round((1 - cookRatio) * 100)}% 记为熟食浪费。</span></div></div>
            {message && <div className="alert"><AlertTriangle size={18} />{message}</div>}
            <button className="button primary wide" onClick={() => { const result = cookRecipe(recipe.id, cookRatio); if (result.shortage.length) setMessage(result.shortage.join("；")); else setCookOpen(false); }}>确认制作并记账</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Metric({ label, value, note }: { label: string; value: string; note: string }) {
  return <article className="metric-card"><span>{label}</span><strong>{value}</strong><small>{note}</small></article>;
}

function MealModal({ onClose, onSave }: { onClose: () => void; onSave: (input: { name: string; type: MealType; amountLabel: string; calories: number; protein: number; fiber?: number }) => void }) {
  const [form, setForm] = useState({ name: "", type: "breakfast" as MealType, amountLabel: "", calories: "", protein: "", fiber: "" });
  return (
    <Modal title="添加确认过的食物" onClose={onClose}>
      <form className="form" onSubmit={(event) => { event.preventDefault(); onSave({ ...form, calories: Number(form.calories), protein: Number(form.protein), fiber: form.fiber ? Number(form.fiber) : undefined }); }}>
        <label><span>餐次</span><select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value as MealType })}>{Object.entries(mealLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
        <label><span>食物或菜品名称</span><input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="例如 鸡蛋、燕麦与无糖酸奶" /></label>
        <label><span>份量说明</span><input required value={form.amountLabel} onChange={(event) => setForm({ ...form, amountLabel: event.target.value })} placeholder="例如 鸡蛋3个、燕麦50克" /></label>
        <div className="form-grid"><label><span>热量 kcal</span><input required type="number" min="0" value={form.calories} onChange={(event) => setForm({ ...form, calories: event.target.value })} /></label><label><span>蛋白质 g</span><input required type="number" min="0" step="0.1" value={form.protein} onChange={(event) => setForm({ ...form, protein: event.target.value })} /></label></div>
        <label><span>膳食纤维 g（可留空，留空不等于 0）</span><input type="number" min="0" step="0.1" value={form.fiber} onChange={(event) => setForm({ ...form, fiber: event.target.value })} /></label>
        <button className="button primary wide" type="submit">确认写入饮食日记</button>
      </form>
    </Modal>
  );
}
