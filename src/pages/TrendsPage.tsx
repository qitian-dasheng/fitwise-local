import { diaryToday, shiftDiaryDate, type DiaryDateProps } from "../domain/diary";
import { DiaryDateControl } from "../components/DiaryDateControl";
import { Activity, CalendarCheck, Dumbbell, Utensils } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { activeMeals, completedDayCalorieAverage, completedDayCount, summarizeMeals } from "../domain/calculations";
import { PageHeader } from "../components/PageHeader";
import { useAppStore } from "../store/appStore";
import { usePeriodSummary } from "../data/domainQueries";

export function TrendsPage({
  date = diaryToday(),
  onDateChange,
  goTo,
}: DiaryDateProps & { goTo?: (page: string) => void } = {}) {
  const meals = useAppStore((state) => state.meals);
  const checkIns = useAppStore((state) => state.checkIns);
  const workouts = useAppStore((state) => state.workouts);
  const start = shiftDiaryDate(date, -6);
  const end = date;
  const period = usePeriodSummary(start, end);
  const calorieData = period.data ? period.data.days.map((day) => ({ date: day.date.slice(5), calories: day.mealCount > 0 && activeMeals(meals).filter(m => m.date === day.date).every(m => m.nutrition.calories.state !== "unknown") ? Math.round(day.totals.calories) : null, complete: day.complete })) : Array.from({ length: 7 }, (_, index) => {
    const date = shiftDiaryDate(end, index - 6);
    const entries = activeMeals(meals).filter((item) => item.date === date);
    return { date: date.slice(5), calories: entries.length > 0 && entries.every(m => m.nutrition.calories.state !== "unknown") ? Math.round(summarizeMeals(entries).totals.calories) : null, complete: checkIns.some((item) => item.date === date && item.complete) };
  });
  const averageCalories = period.data ? period.data.completedDayCalorieAverage : completedDayCalorieAverage(meals.filter((item) => item.date >= start && item.date <= end), checkIns);
  const workoutMinutes = period.data?.workoutMinutes ?? workouts.filter((item) => item.date >= start && item.date <= end).reduce((sum, item) => sum + item.durationMinutes, 0);
  const completedDays = period.data ? period.data.days.filter((day) => day.complete).length : completedDayCount(checkIns, start, end);
  const mealCount = period.data
    ? period.data.days.reduce((sum, day) => sum + day.mealCount, 0)
    : activeMeals(meals).filter((item) => item.date >= start && item.date <= end).length;

  if (period.loading || period.error) return <div className="page"><PageHeader eyebrow="周报" title="趋势与周报" description={period.error ? "读取趋势失败，请重新打开此页面后重试。" : "正在读取本地趋势…"}/>{period.error && <p className="form-error" role="alert">{period.error}</p>}</div>;
  return (
    <div className="page">
      <PageHeader
        eyebrow="只看确认过的事实"
        title="趋势与周报"
        description="体重已移到「身体」页；这里只看热量、完整日与运动。未完成日期不进入平均值，运动消耗也不会抵扣饮食预算。"
        action={goTo ? <button className="button secondary" onClick={() => goTo("body")}>查看身体记录</button> : undefined}
      />
      <DiaryDateControl date={date} onChange={onDateChange}/>
      <p className="form-hint">统计区间 {start} 至 {end}。热量图展示已知摄入，未记录或热量不全的日留空；仅完成日用于日均。</p>
      <div className="metric-row">
        <Metric icon={<Activity />} label="完整记录日均" value={averageCalories === null ? "数据不足" : `${Math.round(averageCalories)} kcal`} />
        <Metric icon={<CalendarCheck />} label="完整记录日" value={`${completedDays} / 7 天`} />
        <Metric icon={<Dumbbell />} label="近七日运动" value={`${workoutMinutes} 分钟`} />
        <Metric icon={<Utensils />} label="近七日记录餐次" value={`${mealCount} 次`} />
      </div>
      <section className="card chart-card">
        <div className="card-heading compact"><div><p className="eyebrow">图示摄入 · 完成日计均值</p><h2>近七日热量</h2></div></div>
        <div className="chart-large"><ResponsiveContainer width="100%" height="100%"><BarChart data={calorieData}><CartesianGrid vertical={false} stroke="#e8ebe5"/><XAxis dataKey="date" axisLine={false} tickLine={false}/><YAxis axisLine={false} tickLine={false}/><Tooltip/><Bar dataKey="calories" fill="#d9a441" radius={[8,8,0,0]}/></BarChart></ResponsiveContainer></div>
      </section>
      <section className="card weekly-review"><div className="insight-icon"><Activity size={20}/></div><div><p className="eyebrow">周报规则</p><h2>目标调整建议尚未启用</h2><p>请持续收集晨重、完整饮食日、饥饿感和精力。后续至少核对两周有效数据后才提出调整草稿；目前不会自动修改目标，也不把数据齐全误当成已完成健康评估。</p></div></section>
    </div>
  );
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) { return <article className="metric-card icon-metric"><span className="metric-icon">{icon}</span><div><span>{label}</span><strong>{value}</strong></div></article>; }
