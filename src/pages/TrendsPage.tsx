import { diaryToday, shiftDiaryDate, type DiaryDateProps } from "../domain/diary";
import { DiaryDateControl } from "../components/DiaryDateControl";
import { Activity, CalendarCheck, Dumbbell, Scale } from "lucide-react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { activeMeals, activeMeasurements, completedDayCalorieAverage, movingAverage, summarizeMeals } from "../domain/calculations";
import { PageHeader } from "../components/PageHeader";
import { useAppStore } from "../store/appStore";
import { usePeriodSummary } from "../data/domainQueries";

export function TrendsPage({ date = diaryToday(), onDateChange }: DiaryDateProps = {}) {
  const measurements = useAppStore((state) => state.measurements);
  const meals = useAppStore((state) => state.meals);
  const checkIns = useAppStore((state) => state.checkIns);
  const workouts = useAppStore((state) => state.workouts);
  const profile = useAppStore((state) => state.profile);
  const start = shiftDiaryDate(date, -6);
  const end = date;
  const period = usePeriodSummary(start, end);
  const currentMeasurements = activeMeasurements(measurements).filter(item => item.date <= end);
  const weights = currentMeasurements.map((item) => ({ date: item.date, value: item.weightKg }));
  const avg = movingAverage(weights);
  const weightData = period.data ? period.data.measurements.map((item) => ({ date: item.date.slice(5), weight: item.weightKg, average: item.average })) : weights.map((item, index) => ({ fullDate: item.date, date: item.date.slice(5), weight: item.value, average: avg[index].value })).filter(item => item.fullDate >= start);
  const calorieData = period.data ? period.data.days.map((day) => ({ date: day.date.slice(5), calories: day.mealCount > 0 && activeMeals(meals).filter(m => m.date === day.date).every(m => m.nutrition.calories.state !== "unknown") ? Math.round(day.totals.calories) : null, complete: day.complete })) : Array.from({ length: 7 }, (_, index) => {
    const date = shiftDiaryDate(end, index - 6);
    const entries = activeMeals(meals).filter((item) => item.date === date);
    return { date: date.slice(5), calories: entries.length > 0 && entries.every(m => m.nutrition.calories.state !== "unknown") ? Math.round(summarizeMeals(entries).totals.calories) : null, complete: checkIns.some((item) => item.date === date && item.complete) };
  });
  const averageCalories = period.data ? period.data.completedDayCalorieAverage : completedDayCalorieAverage(meals.filter((item) => item.date >= start && item.date <= end), checkIns);
  const workoutMinutes = period.data?.workoutMinutes ?? workouts.filter((item) => item.date >= start && item.date <= end).reduce((sum, item) => sum + item.durationMinutes, 0);
  const latestWeight = period.data ? period.data.latestWeightKg : currentMeasurements.at(-1)?.weightKg;
  if (period.loading || period.error) return <div className="page"><PageHeader eyebrow="周报" title="趋势与周报" description={period.error ? "读取趋势失败，请重新打开此页面后重试。" : "正在读取本地趋势…"}/>{period.error && <p className="form-error" role="alert">{period.error}</p>}</div>;
  return (
    <div className="page">
      <PageHeader eyebrow="只看确认过的事实" title="趋势与周报" description="未完成日期不进入平均值，运动消耗也不会抵扣饮食预算。" />
      <DiaryDateControl date={date} onChange={onDateChange}/>
      <p className="form-hint">统计区间 {start} 至 {end}。热量图展示已知摄入，未记录或热量不全的日留空；仅完成日用于日均。</p>
      <div className="metric-row">
        <Metric icon={<Scale />} label="最新体重" value={`${latestWeight?.toFixed(1) ?? "—"} kg`} />
        <Metric icon={<Activity />} label="距阶段目标" value={`${((latestWeight ?? profile.startWeightKg) - profile.targetWeightKg).toFixed(1)} kg`} />
        <Metric icon={<CalendarCheck />} label="完整记录日均" value={averageCalories === null ? "数据不足" : `${Math.round(averageCalories)} kcal`} />
        <Metric icon={<Dumbbell />} label="近七日运动" value={`${workoutMinutes} 分钟`} />
      </div>
      <div className="two-column equal">
        <section className="card chart-card"><div className="card-heading compact"><div><p className="eyebrow">七日移动平均</p><h2>体重趋势</h2></div></div><div className="chart-large">{weightData.length > 1 ? <ResponsiveContainer width="100%" height="100%"><AreaChart data={weightData}><defs><linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#276a53" stopOpacity={0.25}/><stop offset="1" stopColor="#276a53" stopOpacity={0}/></linearGradient></defs><CartesianGrid vertical={false} stroke="#e8ebe5" /><XAxis dataKey="date" axisLine={false} tickLine={false}/><YAxis domain={["dataMin - 1", "dataMax + 1"]} axisLine={false} tickLine={false}/><Tooltip/><Area type="monotone" dataKey="weight" stroke="#b6bcb4" fill="none" strokeDasharray="4 4"/><Area type="monotone" dataKey="average" stroke="#276a53" strokeWidth={3} fill="url(#trendFill)"/></AreaChart></ResponsiveContainer> : <div className="empty-chart"><Scale /><span>至少需要两次体重记录</span></div>}</div></section>
        <section className="card chart-card"><div className="card-heading compact"><div><p className="eyebrow">图示摄入 · 完成日计均值</p><h2>近七日热量</h2></div></div><div className="chart-large"><ResponsiveContainer width="100%" height="100%"><BarChart data={calorieData}><CartesianGrid vertical={false} stroke="#e8ebe5"/><XAxis dataKey="date" axisLine={false} tickLine={false}/><YAxis axisLine={false} tickLine={false}/><Tooltip/><Bar dataKey="calories" fill="#d9a441" radius={[8,8,0,0]}/></BarChart></ResponsiveContainer></div></section>
      </div>
      <section className="card weekly-review"><div className="insight-icon"><Activity size={20}/></div><div><p className="eyebrow">周报规则</p><h2>目标调整建议尚未启用</h2><p>请持续收集晨重、完整饮食日、饥饿感和精力。后续至少核对两周有效数据后才提出调整草稿；目前不会自动修改目标，也不把数据齐全误当成已完成健康评估。</p></div></section>
    </div>
  );
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) { return <article className="metric-card icon-metric"><span className="metric-icon">{icon}</span><div><span>{label}</span><strong>{value}</strong></div></article>; }
