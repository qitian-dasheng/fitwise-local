import { format } from "date-fns";
import { zhCN } from "date-fns/locale";
import { ArrowRight, Check, Dumbbell, Plus, Scale, Sparkles, Utensils, Wheat } from "lucide-react";
import { useMemo, useState } from "react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { activeMeasurements, summarizeMeals } from "../domain/calculations";
import { useAppStore } from "../store/appStore";
import { Modal } from "../components/Modal";
import { NutritionRing } from "../components/NutritionRing";
import { PageHeader } from "../components/PageHeader";
import { useConfirmedAction } from "../components/useConfirmedAction";
import { usePeriodSummary } from "../data/domainQueries";

const mealLabels = { breakfast: "早餐", lunch: "午餐", dinner: "晚餐", snack: "加餐" } as const;

export function TodayPage({ goTo }: { goTo: (page: string) => void }) {
  const [weightOpen, setWeightOpen] = useState(false);
  const [weight, setWeight] = useState("");
  const action = useConfirmedAction();
  const profile = useAppStore((state) => state.profile);
  const meals = useAppStore((state) => state.meals);
  const measurements = useAppStore((state) => state.measurements);
  const workouts = useAppStore((state) => state.workouts);
  const checkIns = useAppStore((state) => state.checkIns);
  const inventory = useAppStore((state) => state.inventory);
  const plans = useAppStore((state) => state.plans);
  const addWeight = useAppStore((state) => state.addWeight);
  const setCheckIn = useAppStore((state) => state.setCheckIn);
  const toggleDayComplete = useAppStore((state) => state.toggleDayComplete);
  const today = format(new Date(), "yyyy-MM-dd");
  const period = usePeriodSummary(today, today);
  const todayMeals = meals.filter((meal) => meal.date === today);
  const summary = period.data?.days[0] ?? summarizeMeals(todayMeals);
  const todayWorkouts = workouts.filter((item) => item.date === today);
  const todayCheck = checkIns.find((item) => item.date === today);
  const selectedPlan = plans.find((item) => item.status === "selected") ?? plans[0];
  const currentMeasurements = activeMeasurements(measurements);
  const weightData = currentMeasurements.slice(-14).map((item) => ({ date: item.date.slice(5), weight: item.weightKg }));
  const latestWeight = period.data?.latestWeightKg ?? currentMeasurements.at(-1)?.weightKg ?? profile.startWeightKg;
  const expiringCount = useMemo(() => inventory.filter((item) => item.remainingAmount > 0 && item.expiresAt && new Date(item.expiresAt).getTime() - Date.now() < 3 * 864e5).length, [inventory]);

  if (period.loading || period.error) return <div className="page"><PageHeader eyebrow="今日" title="今日记录" description={period.error ? "读取记录失败，请重新打开此页面后重试。" : "正在读取本地记录…"}/>{period.error && <p className="form-error" role="alert">{period.error}</p>}</div>;

  return (
    <div className="page">
      <PageHeader
        eyebrow={format(new Date(), "yyyy年M月d日 EEEE", { locale: zhCN })}
        title={`早上好，${profile.name}`}
        description="先记录事实，再让趋势说话。今天的建议不会因为一次波动而改变。"
        action={
          <button className={todayCheck?.complete ? "button success" : "button primary"} disabled={action.busy} onClick={() => { void action.run(`complete:${today}:${!todayCheck?.complete}`, (id) => toggleDayComplete(id)); }}>
            <Check size={17} /> {todayCheck?.complete ? "今日已完成" : "完成今日记录"}
          </button>
        }
      />
      {action.message && <div className="settings-notice card" role="alert">{action.message}</div>}

      <section className="hero-grid">
        <article className="card nutrition-hero">
          <div className="card-heading">
            <div>
              <p className="eyebrow">今日摄入</p>
              <h2>{Math.round(summary.totals.calories)} 千卡</h2>
            </div>
            <span className="status-pill neutral">目标 {profile.dailyCalories.min}–{profile.dailyCalories.max}</span>
          </div>
          <div className="rings-row">
            <NutritionRing value={summary.totals.calories} max={profile.dailyCalories.target} label="热量 · kcal" />
            <NutritionRing value={summary.totals.protein} max={profile.proteinTargetG} label="蛋白质 · g" color="var(--blue)" />
            <NutritionRing value={summary.totals.fiber} max={profile.fiberTargetG} label="纤维 · g" color="var(--amber)" />
          </div>
          <div className="coverage-note">
            <span>营养数据覆盖率</span>
            <strong>{summary.coverage.calories}%</strong>
            <div className="mini-progress"><i style={{ width: `${summary.coverage.calories}%` }} /></div>
          </div>
        </article>

        <article className="card weight-card">
          <div className="card-heading compact">
            <div>
              <p className="eyebrow">{currentMeasurements.length ? "体重趋势" : "起始参考 · 尚未记录晨重"}</p>
              <h2>{latestWeight.toFixed(1)} <small>kg</small></h2>
            </div>
            <button className="icon-button solid" onClick={() => setWeightOpen(true)} aria-label="记录体重"><Plus size={19} /></button>
          </div>
          <div className="weight-target"><span>阶段目标 {profile.targetWeightKg} kg</span><b>还差 {(latestWeight - profile.targetWeightKg).toFixed(1)} kg</b></div>
          <div className="chart-small">
            {weightData.length > 1 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={weightData} margin={{ top: 8, right: 4, bottom: 0, left: -24 }}>
                  <defs><linearGradient id="weightFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#276a53" stopOpacity={0.28} /><stop offset="100%" stopColor="#276a53" stopOpacity={0} /></linearGradient></defs>
                  <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: "#8a918a" }} />
                  <YAxis domain={["dataMin - 1", "dataMax + 1"]} axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: "#8a918a" }} />
                  <Tooltip />
                  <Area type="monotone" dataKey="weight" stroke="#276a53" strokeWidth={2.5} fill="url(#weightFill)" />
                </AreaChart>
              </ResponsiveContainer>
            ) : <div className="empty-chart"><Scale size={24} /><span>再记录一次即可形成趋势</span></div>}
          </div>
        </article>
      </section>

      <section className="content-grid">
        <article className="card meals-card">
          <div className="card-heading compact">
            <div><p className="eyebrow">饮食日记</p><h2>今天吃了什么</h2></div>
            <button className="text-button" onClick={() => goTo("food")}>记录饮食 <ArrowRight size={16} /></button>
          </div>
          <div className="meal-list">
            {(["breakfast", "lunch", "dinner", "snack"] as const).map((type) => {
              const entries = todayMeals.filter((meal) => meal.type === type);
              return (
                <div className="meal-row" key={type}>
                  <div className={`meal-icon ${type}`}><Utensils size={17} /></div>
                  <div className="meal-content">
                    <strong>{mealLabels[type]}</strong>
                    <span>{entries.length ? entries.map((item) => item.name).join("、") : "尚未记录"}</span>
                  </div>
                  <b>{Math.round(summarizeMeals(entries).totals.calories)} <small>kcal</small></b>
                </div>
              );
            })}
          </div>
        </article>

        <div className="stack">
          <article className="card insight-card">
            <div className="insight-icon"><Sparkles size={19} /></div>
            <div>
              <p className="eyebrow">今日助手</p>
              <h3>{todayMeals.length ? "按计划继续，不需要补偿性节食" : "先记录早餐或第一餐"}</h3>
              <p>{todayMeals.length ? `当前蛋白质 ${Math.round(summary.totals.protein)} 克。完成记录后再判断是否需要调整下一餐。` : "系统只根据确认过的数据给建议；没有记录时不会把空白当成低摄入。"}</p>
              <button className="text-button" onClick={() => goTo("assistant")}>继续追问 <ArrowRight size={16} /></button>
            </div>
          </article>

          <article className="card quick-status">
            <div className="quick-item"><Dumbbell size={19} /><span>今日运动</span><b>{(period.data?.workoutMinutes ?? todayWorkouts.reduce((sum, item) => sum + item.durationMinutes, 0)) || "未记录"}{period.data?.workoutMinutes || todayWorkouts.length ? " 分钟" : ""}</b></div>
            <div className="quick-item"><Wheat size={19} /><span>临期库存</span><b className={expiringCount ? "warning-text" : ""}>{expiringCount} 项</b></div>
          </article>
        </div>
      </section>

      <section className="card tomorrow-strip">
        <div className="tomorrow-date"><span>明日</span><strong>{format(new Date(Date.now() + 864e5), "MM.dd")}</strong></div>
        <div className="tomorrow-main">
          <p className="eyebrow">候选菜单 · 库存优先</p>
          <h3>{selectedPlan.title}</h3>
          <p>{selectedPlan.description}</p>
        </div>
        <div className="tomorrow-metrics"><span><b>{selectedPlan.inventoryCoverage}%</b> 库存覆盖</span><span><b>{selectedPlan.cookingMinutes}</b> 分钟</span></div>
        <button className="button secondary" onClick={() => goTo("plan")}>查看 3 个方案</button>
      </section>

      <section className="checkin-bar card">
        <div><p className="eyebrow">主观状态</p><h3>今天感觉怎么样？</h3></div>
        <Rating label="饥饿感" disabled={action.busy} value={todayCheck?.hunger} onChange={(hunger) => { void action.run(`hunger:${today}:${hunger}`, (id) => setCheckIn({ hunger }, id)); }} />
        <Rating label="精力" disabled={action.busy} value={todayCheck?.energy} onChange={(energy) => { void action.run(`energy:${today}:${energy}`, (id) => setCheckIn({ energy }, id)); }} />
      </section>

      {weightOpen && (
        <Modal title="记录晨起体重" onClose={() => { if (!action.busy) setWeightOpen(false); }}>
          <form className="form" onSubmit={async (event) => { event.preventDefault(); const value = Number(weight); const result = await action.run(`weight:${today}:${value}`, (id) => addWeight(value, today, id)); if (!result.error) { setWeightOpen(false); setWeight(""); if (result.isOutlier) action.setMessage("本次体重与最近记录相差较大，已保留原始值，请复核称量。 "); } }}>
            <label><span>体重（kg）</span><input autoFocus inputMode="decimal" value={weight} onChange={(event) => setWeight(event.target.value)} placeholder="例如 82.6" /></label>
            <p className="form-hint">相同日期重复记录会把旧值标为“已修订”并保留审计，不会静默删除；异常波动也不会自动删除。</p>
            {action.message && <p className="form-error" role="alert">{action.message}</p>}
            <button className="button primary wide" type="submit" disabled={action.busy}>{action.busy ? "正在保存…" : "确认记录"}</button>
          </form>
        </Modal>
      )}
    </div>
  );
}

function Rating({ label, value, onChange, disabled }: { label: string; value?: number; onChange: (value: number) => void; disabled?: boolean }) {
  return (
    <div className="rating">
      <span>{label}</span>
      <div>{[1, 2, 3, 4, 5].map((item) => <button disabled={disabled} className={value === item ? "active" : ""} onClick={() => onChange(item)} key={item}>{item}</button>)}</div>
    </div>
  );
}
