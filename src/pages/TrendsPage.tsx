import { format, subDays } from "date-fns";
import { Activity, CalendarCheck, Dumbbell, Scale } from "lucide-react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { activeMeasurements, completedDayCalorieAverage, movingAverage, summarizeMeals } from "../domain/calculations";
import { PageHeader } from "../components/PageHeader";
import { useAppStore } from "../store/appStore";

export function TrendsPage() {
  const measurements = useAppStore((state) => state.measurements);
  const meals = useAppStore((state) => state.meals);
  const checkIns = useAppStore((state) => state.checkIns);
  const workouts = useAppStore((state) => state.workouts);
  const profile = useAppStore((state) => state.profile);
  const currentMeasurements = activeMeasurements(measurements);
  const weights = currentMeasurements.map((item) => ({ date: item.date, value: item.weightKg }));
  const avg = movingAverage(weights);
  const weightData = weights.map((item, index) => ({ date: item.date.slice(5), weight: item.value, average: avg[index].value }));
  const calorieData = Array.from({ length: 7 }, (_, index) => {
    const date = format(subDays(new Date(), 6 - index), "yyyy-MM-dd");
    const entries = meals.filter((item) => item.date === date);
    return { date: date.slice(5), calories: Math.round(summarizeMeals(entries).totals.calories), complete: checkIns.some((item) => item.date === date && item.complete) };
  });
  const averageCalories = completedDayCalorieAverage(meals, checkIns);
  return (
    <div className="page">
      <PageHeader eyebrow="只看确认过的事实" title="趋势与周报" description="未完成日期不进入平均值，运动消耗也不会抵扣饮食预算。" />
      <div className="metric-row">
        <Metric icon={<Scale />} label="最新体重" value={`${currentMeasurements.at(-1)?.weightKg.toFixed(1) ?? "—"} kg`} />
        <Metric icon={<Activity />} label="距阶段目标" value={`${((currentMeasurements.at(-1)?.weightKg ?? profile.startWeightKg) - profile.targetWeightKg).toFixed(1)} kg`} />
        <Metric icon={<CalendarCheck />} label="完整记录日均" value={averageCalories === null ? "数据不足" : `${Math.round(averageCalories)} kcal`} />
        <Metric icon={<Dumbbell />} label="本周运动" value={`${workouts.reduce((sum, item) => sum + item.durationMinutes, 0)} 分钟`} />
      </div>
      <div className="two-column equal">
        <section className="card chart-card"><div className="card-heading compact"><div><p className="eyebrow">七日移动平均</p><h2>体重趋势</h2></div></div><div className="chart-large">{weightData.length > 1 ? <ResponsiveContainer width="100%" height="100%"><AreaChart data={weightData}><defs><linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#276a53" stopOpacity={0.25}/><stop offset="1" stopColor="#276a53" stopOpacity={0}/></linearGradient></defs><CartesianGrid vertical={false} stroke="#e8ebe5" /><XAxis dataKey="date" axisLine={false} tickLine={false}/><YAxis domain={["dataMin - 1", "dataMax + 1"]} axisLine={false} tickLine={false}/><Tooltip/><Area type="monotone" dataKey="weight" stroke="#b6bcb4" fill="none" strokeDasharray="4 4"/><Area type="monotone" dataKey="average" stroke="#276a53" strokeWidth={3} fill="url(#trendFill)"/></AreaChart></ResponsiveContainer> : <div className="empty-chart"><Scale /><span>至少需要两次体重记录</span></div>}</div></section>
        <section className="card chart-card"><div className="card-heading compact"><div><p className="eyebrow">仅完成日有效</p><h2>近七日热量</h2></div></div><div className="chart-large"><ResponsiveContainer width="100%" height="100%"><BarChart data={calorieData}><CartesianGrid vertical={false} stroke="#e8ebe5"/><XAxis dataKey="date" axisLine={false} tickLine={false}/><YAxis axisLine={false} tickLine={false}/><Tooltip/><Bar dataKey="calories" fill="#d9a441" radius={[8,8,0,0]}/></BarChart></ResponsiveContainer></div></section>
      </div>
      <section className="card weekly-review"><div className="insight-icon"><Activity size={20}/></div><div><p className="eyebrow">周报规则</p><h2>暂不建议调整目标</h2><p>目前不足 14 天有效数据。系统会继续收集晨重、完整饮食日、饥饿感和精力；单日波动不会触发减热量建议。</p></div></section>
    </div>
  );
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) { return <article className="metric-card icon-metric"><span className="metric-icon">{icon}</span><div><span>{label}</span><strong>{value}</strong></div></article>; }
