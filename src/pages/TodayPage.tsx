import { format } from "date-fns";
import { zhCN } from "date-fns/locale";
import { diaryToday, shiftDiaryDate, type DiaryDateProps } from "../domain/diary";
import { ArrowRight, Check, ChevronLeft, ChevronRight, Dumbbell, Plus, Scale, Utensils } from "lucide-react";
import { activeMeals, summarizeMeals } from "../domain/calculations";
import { dailyRepresentatives } from "../domain/body";
import { bodyActionHint, calorieBudget, mealActionHint, recordStreak, workoutActionHint } from "../domain/todayHints";
import { frequentFoods, lastPortionForVersion } from "../domain/meals";
import type { MealType } from "../domain/types";
import { useAppStore } from "../store/appStore";
import { Rating } from "../components/Rating";
import { useConfirmedAction } from "../components/useConfirmedAction";
import { usePeriodSummary } from "../data/domainQueries";
import { useEnergyUnit } from "../hooks/useEnergyUnit";
import { energyUnitNames, toDisplayEnergy } from "../domain/energyDisplay";

const mealLabels = { breakfast: "早餐", lunch: "午餐", dinner: "晚餐", snack: "加餐" } as const;

/** 今日页「补记一笔」的三个入口；food 额外带餐次，用来把表单开在真正待记的那一餐上。 */
export type QuickActionKind = "food" | "workout" | "body";
export type QuickActionHandler = (kind: QuickActionKind, mealType?: MealType) => void;

/**
 * 今日页（0.9.3 方向 D 驾驶舱形态）：
 * 指标卡行（还能吃/体重/蛋白/连续）→ 热量环+宏量条 | 14 天柱 → 餐次+常吃/主观状态。
 * 数字优先、语义色只进数据、一屏不滚；数据口径与 0.9.2 完全一致（calorieBudget/recordStreak/frequentFoods）。
 */
export function TodayPage({ goTo, date = diaryToday(), onDateChange, onQuickAction }: { goTo: (page: string) => void; onQuickAction?: QuickActionHandler } & DiaryDateProps) {
  const action = useConfirmedAction();
  const [energyUnit] = useEnergyUnit();
  const profile = useAppStore((state) => state.profile);
  const meals = useAppStore((state) => state.meals);
  const measurements = useAppStore((state) => state.measurements);
  const workouts = useAppStore((state) => state.workouts);
  const checkIns = useAppStore((state) => state.checkIns);
  const foodDefinitions = useAppStore((state) => state.foodDefinitions);
  const foodDefinitionVersions = useAppStore((state) => state.foodDefinitionVersions);
  const setCheckIn = useAppStore((state) => state.setCheckIn);
  const setDayComplete = useAppStore((state) => state.setDayComplete);
  const today = date;
  const period = usePeriodSummary(today, today);
  const chartPeriod = usePeriodSummary(shiftDiaryDate(today, -13), today);
  const todayMeals = activeMeals(meals).filter((meal) => meal.date === today);
  const summary = period.data?.days[0] ?? summarizeMeals(todayMeals);
  const todayWorkouts = workouts.filter((item) => item.date === today);
  const todayCheck = checkIns.find((item) => item.date === today);
  const currentMeasurements = dailyRepresentatives(measurements).filter((item) => item.date <= date);
  const weightData = currentMeasurements.slice(-14).map((item) => ({ date: item.date.slice(5), weight: item.weightKg }));
  const latestWeight = period.data?.latestWeightKg ?? currentMeasurements.at(-1)?.weightKg ?? profile.startWeightKg;
  const budget = calorieBudget(summary.totals.calories, summary.coverage.calories, profile.dailyCalories, todayMeals.length > 0);
  const streak = recordStreak(meals, checkIns, today);
  const frequent = frequentFoods(meals, foodDefinitions, foodDefinitionVersions, today);
  const bodyHint = bodyActionHint(measurements, today, diaryToday());
  const proteinPct = profile.proteinTargetG > 0 ? Math.min(100, Math.round((summary.totals.protein / profile.proteinTargetG) * 100)) : 0;
  const chartDays = chartPeriod.data?.days ?? [];
  const trendDays = Array.from({ length: 14 }, (_, index) => {
    const day = shiftDiaryDate(today, index - 13);
    const known = chartDays.find((item) => item.date === day);
    const complete = known && known.mealCount > 0 && known.coverage.calories >= 100;
    return { date: day, calories: complete ? Math.round(toDisplayEnergy(known!.totals.calories, energyUnit)) : null };
  });
  const trendMax = Math.max(profile.dailyCalories.max * 1.15, ...trendDays.map((day) => day.calories ?? 0));
  const macroTotal = Math.max(1, summary.totals.protein + summary.totals.carbohydrates + summary.totals.fat);
  const spark = weightData.slice(-7);
  const sparkMin = Math.min(...spark.map((row) => row.weight));
  const sparkMax = Math.max(...spark.map((row) => row.weight));

  if (period.loading || period.error) {
    return (
      <div className="page">
        <div className="ui-page-head"><div><div className="date">{format(new Date(`${date}T12:00:00+08:00`), "M月d日", { locale: zhCN })}</div><h1>{period.error ? "读取记录失败" : "今日"}</h1></div></div>
        {period.error && <div className="ui-card"><p className="ui-chart-foot" role="alert">{period.error}。请重新打开本页重试；记录不会因此丢失。</p></div>}
      </div>
    );
  }

  return (
    <div className="page ui-today" style={{ display: "flex", flexDirection: "column", gap: 13, flex: 1, minHeight: 0 }}>
      <header className="ui-page-head">
        <div>
          <div className="date">{format(new Date(`${date}T12:00:00+08:00`), "yyyy年M月d日 EEEE", { locale: zhCN })}{date === diaryToday() ? ` · 你好，${profile.name}` : " · 历史日报"}</div>
          <h1>今日</h1>
        </div>
        <div className="actions" style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div className="ui-datestrip">
            <button className="ui-navbtn" aria-label="前一天" onClick={() => onDateChange?.(shiftDiaryDate(date, -1))}><ChevronLeft size={15} /></button>
            <input type="date" aria-label="查看日期" value={date} onChange={(event) => event.target.value && onDateChange?.(event.target.value)} style={{ all: "unset", cursor: "pointer", font: "inherit", color: "var(--ui-ink-2)" }} />
            <button className="ui-navbtn" aria-label="后一天" disabled={date >= diaryToday()} onClick={() => onDateChange?.(shiftDiaryDate(date, 1))}><ChevronRight size={15} /></button>
            {date !== diaryToday() && <button className="ui-btn" onClick={() => onDateChange?.(diaryToday())}>回到今天</button>}
          </div>
          <button className="ui-btn" onClick={() => onQuickAction?.("workout")}><Dumbbell size={15} /> 记运动</button>
          <button className="ui-btn" onClick={() => goTo("body")} title={bodyHint}><Scale size={15} /> 称重</button>
          <button className="ui-btn primary" onClick={() => onQuickAction?.("food", mealActionHint(meals, today).slot ?? undefined)}><Plus size={15} /> 记一笔</button>
        </div>
      </header>

      <section className="ui-kpi-row">
        <div className="ui-card ui-kpi">
          <div className="label"><span>还能吃</span><span className="ui-badge flat">区间 {Math.round(toDisplayEnergy(profile.dailyCalories.min, energyUnit))}–{Math.round(toDisplayEnergy(profile.dailyCalories.max, energyUnit))}</span></div>
          <div className="value">{budget.status === "no-records" ? "—" : budget.status === "over" ? `超 ${budget.overBy}` : `${budget.remainingLow ?? budget.remainingHigh}–${budget.remainingHigh}`}<small>{energyUnitNames[energyUnit]}</small></div>
          <div className="sub">{budget.status === "no-records" ? "记录第一餐后显示剩余" : budget.status === "over" ? `已摄入 ${Math.round(toDisplayEnergy(budget.consumedKnown, energyUnit))}，超上限 ${Math.round(toDisplayEnergy(budget.overBy ?? 0, energyUnit))}` : budget.status === "partial" ? `已知部分 ${Math.round(toDisplayEnergy(budget.consumedKnown, energyUnit))} · 还有未计入` : `已摄入 ${Math.round(toDisplayEnergy(budget.consumedKnown, energyUnit))}`}</div>
          {budget.status !== "no-records" && (
            <div className="ui-microbar"><i style={{ width: `${Math.min(100, Math.round((summary.totals.calories / profile.dailyCalories.max) * 100))}%`, background: budget.status === "over" ? "var(--ui-danger)" : budget.status === "partial" ? "var(--ui-warn)" : "var(--ui-ok)" }} /></div>
          )}
        </div>
        <div className="ui-card ui-kpi">
          <div className="label"><span>体重</span>{currentMeasurements.length >= 2 && <span className="ui-badge ok">7 日 {(currentMeasurements.at(-1)!.weightKg - currentMeasurements.at(Math.max(0, currentMeasurements.length - 8))!.weightKg).toFixed(1)}</span>}</div>
          <div className="value">{latestWeight.toFixed(1)}<small>kg · 距目标 {(latestWeight - profile.targetWeightKg).toFixed(1)}</small></div>
          <div className="ui-spark" aria-hidden>{spark.map((item, index) => <b key={item.date} className={index === spark.length - 1 ? "hot" : ""} style={{ height: `${30 + ((item.weight - sparkMin) / Math.max(0.1, sparkMax - sparkMin)) * 60}%` }} />)}</div>
        </div>
        <div className="ui-card ui-kpi">
          <div className="label"><span>蛋白质</span><span className="ui-badge flat">{Math.round(summary.totals.protein)} / {profile.proteinTargetG} g</span></div>
          <div className="value">{proteinPct}<small>%</small></div>
          <div className="ui-microbar"><i style={{ width: `${proteinPct}%`, background: "var(--ui-primary)" }} /></div>
        </div>
        <div className="ui-card ui-kpi">
          <div className="label"><span>连续记录</span></div>
          <div className="value">{streak}<small>天</small></div>
          <div className="ui-streak" aria-label={`连续记录 ${streak} 天`}>{Array.from({ length: 7 }, (_, index) => <i key={index} className={index < Math.min(streak, 7) ? "" : "off"} />)}</div>
        </div>
      </section>

      <section className="ui-mid">
        <div className="ui-card">
          <div className="ui-panel-head"><h2>今日热量</h2><span>环内为剩余 · 完整日口径</span></div>
          <div className="ui-energy">
            <div className="ui-donut">
              <svg width="168" height="168" viewBox="0 0 168 168" role="img" aria-label={`已摄入 ${Math.round(toDisplayEnergy(summary.totals.calories, energyUnit))}，区间上限 ${Math.round(toDisplayEnergy(profile.dailyCalories.max, energyUnit))}`}>
                <circle cx="84" cy="84" r="72" fill="none" stroke="var(--ui-ring-track)" strokeWidth="13" />
                <circle cx="84" cy="84" r="72" fill="none" stroke="var(--ui-primary)" strokeWidth="13" strokeLinecap="round" strokeDasharray={`${(Math.min(1, summary.totals.calories / profile.dailyCalories.max) * 452.4).toFixed(1)} 452.4`} />
              </svg>
              <div className="center"><b>{budget.status === "no-records" ? "—" : budget.status === "over" ? `超${budget.overBy}` : `${budget.remainingHigh ?? 0}`}</b><i>{budget.status === "over" ? `${energyUnitNames[energyUnit]} 已超` : `${energyUnitNames[energyUnit]} 剩余`}</i></div>
            </div>
            <div className="ui-macro">
              <div className="ui-macro-bar" role="img" aria-label={`蛋白质 ${Math.round(summary.totals.protein)} 克、碳水 ${Math.round(summary.totals.carbohydrates)} 克、脂肪 ${Math.round(summary.totals.fat)} 克`}>
                <i style={{ width: `${(summary.totals.protein / macroTotal) * 100}%` }} />
                <i style={{ width: `${(summary.totals.carbohydrates / macroTotal) * 100}%`, opacity: .45 }} />
                <i style={{ width: `${(summary.totals.fat / macroTotal) * 100}%`, opacity: .18 }} />
              </div>
              <div className="ui-macro-legend">
                <div className="row"><i className="sw" />蛋白质<b>{Math.round(summary.totals.protein)} g</b><span>目标 {profile.proteinTargetG}</span></div>
                <div className="row"><i className="sw" style={{ opacity: .45 }} />碳水<b>{summary.coverage.calories >= 100 ? `${Math.round(summary.totals.carbohydrates)} g` : "未知"}</b><span>{summary.coverage.calories >= 100 ? "合计" : "有记录未计入"}</span></div>
                <div className="row"><i className="sw" style={{ opacity: .18 }} />脂肪<b>{summary.coverage.calories >= 100 ? `${Math.round(summary.totals.fat)} g` : "未知"}</b><span>{summary.coverage.calories >= 100 ? "合计" : "有记录未计入"}</span></div>
              </div>
            </div>
          </div>
          <div className="ui-chart-foot">未知营养不计为 0；热量不全的日子不进完整日均值。覆盖率 {summary.coverage.calories}%。</div>
        </div>

        <div className="ui-card">
          <div className="ui-panel-head"><h2>14 天热量</h2><span className="ui-badge flat">{trendDays.filter((day) => day.calories !== null).length} 天完整</span></div>
          <div className="ui-trend">
            <div className="ui-trend-bars" role="img" aria-label="近 14 天完整日热量柱状图，空白为无记录或热量不全">
              <div className="ui-target-band" style={{ bottom: `${(profile.dailyCalories.max / trendMax) * 100}%` }} />
              {trendDays.map((day) => (
                <div key={day.date} className={`day ${day.date === today ? "hot" : ""}`}>
                  <div className="bar"><i style={{ height: day.calories === null ? 0 : `${Math.max(3, (day.calories / trendMax) * 100)}%` }} /></div>
                  <em>{day.date === today ? "今" : day.date.slice(8)}</em>
                </div>
              ))}
            </div>
            <div className="ui-chart-foot">虚线为区间上限。空白 = 无记录或热量不全，不画成 0；运动 {period.data?.workoutMinutes || todayWorkouts.reduce((sum, item) => sum + item.durationMinutes, 0) || 0} 分钟不抵扣。</div>
          </div>
        </div>
      </section>

      <section className="ui-bottom">
        <div className="ui-card">
          <div className="ui-panel-head"><h2>餐次</h2><span>{todayMeals.length ? `${Math.round(toDisplayEnergy(summary.totals.calories, energyUnit))} ${energyUnitNames[energyUnit]} · ${todayMeals.length} 笔` : "尚未记录"}</span></div>
          {(["breakfast", "lunch", "dinner", "snack"] as const).map((type) => {
            const entries = todayMeals.filter((meal) => meal.type === type);
            const totals = summarizeMeals(entries).totals;
            return (
              <div className="ui-meal" key={type}>
                <span className="slot">{mealLabels[type]}</span>
                <span className="desc">{entries.length ? entries.map((item) => item.name).join("、") : <span className="unknown">尚未记录</span>}</span>
                <b>{entries.length ? Math.round(toDisplayEnergy(totals.calories, energyUnit)) : "—"}{entries.length > 0 && <small> {energyUnitNames[energyUnit]}</small>}</b>
              </div>
            );
          })}
          <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center", flexWrap: "wrap" }}>
            <button className="ui-btn" onClick={() => goTo("food")}><Utensils size={14} /> 去记餐 <ArrowRight size={13} /></button>
            <button className={todayCheck?.complete ? "ui-btn" : "ui-btn primary"} disabled={action.busy || (!todayCheck?.complete && !todayMeals.length)} onClick={() => { void action.run(`complete:${today}:${!todayCheck?.complete}`, (id) => setDayComplete(date, !todayCheck?.complete, id)); }}>
              <Check size={14} /> {todayCheck?.complete ? "已完成 · 重新核对" : "确认该日完整"}
            </button>
            <span className="ui-chart-foot" style={{ marginTop: 0, paddingTop: 0, flex: "1 1 260px" }}>确认前请核对所有餐次、饮料及调味料；新增餐食后需重新确认。未知热量日不进完整日均值。</span>
          </div>
        </div>
        <div className="ui-card" style={{ display: "flex", flexDirection: "column", gap: 10, minHeight: 0 }}>
          <div className="ui-panel-head" style={{ marginBottom: 0 }}><h2>常吃</h2><span>去记餐一键按上次份量</span></div>
          <div className="ui-chips">
            {frequent.length ? frequent.map((item) => {
              const last = lastPortionForVersion(meals, item.version.id);
              const perBasis = item.version.labelNutrients.calories !== undefined ? (item.version.labelNutrients.calories / item.version.basis.quantity) * (last?.quantity ?? item.version.basis.quantity) : 0;
              return <button key={item.definition.id} className="ui-chip" title="去饮食页按上次份量记" onClick={() => goTo("food")}><b>{item.definition.name}</b><span>{last ? `上次 ${last.quantity}${last.unit} · 约 ${Math.round(toDisplayEnergy(perBasis, energyUnit))}` : `每 ${item.version.basis.quantity}${item.version.basis.unit}`}</span></button>;
            }) : <p className="ui-chart-foot" style={{ marginTop: 0 }}>记几餐之后，这里会按 30 天频次列出最常吃的食物。</p>}
          </div>
          <div style={{ marginTop: "auto", borderTop: "1px solid var(--ui-line)", paddingTop: 10 }}>
            <div className="ui-panel-head" style={{ marginBottom: 6 }}><h2 style={{ fontSize: 12 }}>这一天感觉怎么样？</h2><span>{workoutActionHint(workouts, today)}</span></div>
            <div style={{ display: "grid", gap: 4 }}>
              <Rating label="饥饿感" disabled={action.busy} value={todayCheck?.hunger} onChange={(hunger) => { void action.run(`hunger:${today}:${hunger}`, (id) => setCheckIn({ hunger, date }, id)); }} />
              <Rating label="精力" disabled={action.busy} value={todayCheck?.energy} onChange={(energy) => { void action.run(`energy:${today}:${energy}`, (id) => setCheckIn({ energy, date }, id)); }} />
            </div>
          </div>
        </div>
      </section>

      {action.message && <div className="ui-card" role="alert" style={{ padding: "8px 14px" }}><p className="ui-chart-foot" style={{ marginTop: 0, paddingTop: 0 }}>{action.message}</p></div>}
    </div>
  );
}
