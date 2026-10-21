import { useMemo, useState } from "react";
import { diaryToday, shiftDiaryDate, type DiaryDateProps } from "../domain/diary";
import { DiaryDateControl } from "../components/DiaryDateControl";
import {
  Activity,
  AlertTriangle,
  CalendarCheck,
  Check,
  Dumbbell,
  Flame,
  Info,
  Scale,
  Utensils,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { activeMeals, summarizeMeals } from "../domain/calculations";
import { PageHeader } from "../components/PageHeader";
import { useAppStore } from "../store/appStore";
import { usePeriodSummary } from "../data/domainQueries";
import { buildReview, RANGE_PRESETS, type RangePreset, type ReviewDay } from "../domain/review";
import { ReviewCalendar } from "../components/ReviewCalendar";
import { WeeklyDeltaGauge } from "../components/WeeklyDeltaGauge";
import { isActiveWorkout } from "../domain/workouts";
import { formatWeight } from "../domain/body";

export function TrendsPage({
  date = diaryToday(),
  onDateChange,
  goTo,
}: DiaryDateProps & { goTo?: (page: string) => void } = {}) {
  const [rangeDays, setRangeDays] = useState<RangePreset>(7);
  const start = shiftDiaryDate(date, -(rangeDays - 1));
  const end = date;

  const period = usePeriodSummary(start, end);
  const meals = useAppStore((state) => state.meals);
  const checkIns = useAppStore((state) => state.checkIns);
  const workouts = useAppStore((state) => state.workouts);
  const measurements = useAppStore((state) => state.measurements);
  const profile = useAppStore((state) => state.profile);

  // 浏览器预览没有 Rust 查询，按同一口径在本地重建 days[]，两条路径产出同一形状。
  const days: ReviewDay[] = useMemo(() => {
    if (period.data) {
      return period.data.days.map((day) => ({
        ...day,
        workoutMinutes: day.workoutMinutes ?? 0,
        workoutCount: day.workoutCount ?? 0,
      }));
    }
    const rebuilt: ReviewDay[] = [];
    for (let offset = 0; offset < rangeDays; offset += 1) {
      const current = shiftDiaryDate(start, offset);
      const entries = activeMeals(meals).filter((item) => item.date === current);
      const summary = summarizeMeals(entries);
      const dayWorkouts = workouts.filter((item) => item.date === current && isActiveWorkout(item));
      rebuilt.push({
        date: current,
        complete: checkIns.some((item) => item.date === current && item.complete),
        mealCount: entries.length,
        totals: summary.totals,
        coverage: summary.coverage,
        workoutMinutes: dayWorkouts.reduce((sum, item) => sum + item.durationMinutes, 0),
        workoutCount: dayWorkouts.length,
      });
    }
    return rebuilt;
  }, [period.data, meals, checkIns, workouts, start, rangeDays]);

  const review = useMemo(
    () => buildReview({ days, measurements, profile, start, end }),
    [days, measurements, profile, start, end],
  );
  const { metrics } = review;

  const chartData = days.map((day) => ({
    date: day.date.slice(5),
    calories:
      day.mealCount > 0 && (day.coverage.calories ?? 0) >= 100 ? Math.round(day.totals.calories ?? 0) : null,
  }));

  if (period.loading || period.error) {
    return (
      <div className="page">
        <PageHeader
          eyebrow="阶段复盘"
          title="趋势与复盘"
          description={period.error ? "读取趋势失败，请重新打开此页面后重试。" : "正在读取本地趋势…"}
        />
        {period.error && <p className="form-error" role="alert">{period.error}</p>}
      </div>
    );
  }

  return (
    <div className="page trends-page">
      <PageHeader
        eyebrow="只看确认过的事实"
        title="阶段复盘"
        description="把一段时间的热量、蛋白与体重均值放在一起看。所有判断都由本地规则算出，不接云端模型，也不构成健康评估。"
        action={goTo ? <button className="button secondary" onClick={() => goTo("body")}><Scale size={15}/> 查看身体记录</button> : undefined}
      />

      <div className="review-controls">
        <DiaryDateControl date={date} onChange={onDateChange} />
        <div className="range-tabs" role="group" aria-label="统计区间">
          {RANGE_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              className={preset === rangeDays ? "active" : ""}
              aria-pressed={preset === rangeDays}
              onClick={() => setRangeDays(preset)}
            >
              {preset} 天
            </button>
          ))}
        </div>
      </div>

      <p className="form-hint">
        统计区间 {start} 至 {end}（{rangeDays} 天）。日均只使用「已确认 + 有餐次 + 热量全部已知」的完整日，缺失的日子不会按 0 摊薄。
      </p>

      <div className="metric-row">
        <Metric
          icon={<Flame />}
          label="日均热量"
          value={metrics.averageCalories === null ? "数据不足" : `${Math.round(metrics.averageCalories)} kcal`}
          note={metrics.averageCalories === null ? "还没有完整记录日" : `完整日 ${metrics.completeDays} 天`}
        />
        <Metric
          icon={<Utensils />}
          label="蛋白达标"
          value={`${metrics.proteinHitDays} / ${metrics.recordedDays} 天`}
          note={`目标 ${profile.proteinTargetG} g`}
        />
        <Metric
          icon={<Scale />}
          label="区间体重变化"
          value={
            metrics.weightChange === null
              ? "数据不足"
              : metrics.weightChange === 0
                ? "持平"
                : `${metrics.weightChange > 0 ? "+" : "−"}${formatWeight(Math.abs(metrics.weightChange))} kg`
          }
          tone={
            metrics.weightChange === null || metrics.weightChange === 0
              ? undefined
              : metrics.weightChange < 0
                ? "down"
                : "up"
          }
          note={metrics.latestWeightKg === null ? "区间内没有称重" : `最新 ${formatWeight(metrics.latestWeightKg)} kg`}
        />
        <Metric
          icon={<Dumbbell />}
          label="区间运动"
          value={`${metrics.workoutCount} 次`}
          note={`共 ${Math.round(metrics.workoutMinutes)} 分钟 · 不抵扣饮食`}
        />
      </div>

      <WeeklyDeltaGauge delta={metrics.weeklyDelta} minRate={metrics.safeMinRate} maxRate={metrics.safeMaxRate} />

      <ReviewCalendar cells={review.calendar} />

      <section className="card chart-card">
        <div className="card-heading compact">
          <div>
            <p className="eyebrow">图示摄入 · 完整日计均值</p>
            <h2>{rangeDays} 天热量</h2>
          </div>
        </div>
        <div className="chart-large">
          {chartData.some((item) => item.calories !== null) ? (
            <ResponsiveContainer width="100%" height="100%">
              {rangeDays <= 14 ? (
              <BarChart data={chartData}>
                <CartesianGrid vertical={false} stroke="#e8ebe5" />
                <XAxis dataKey="date" axisLine={false} tickLine={false} />
                <YAxis axisLine={false} tickLine={false} />
                <Tooltip />
                <Bar dataKey="calories" name="热量 kcal" fill="#d9a441" radius={[8, 8, 0, 0]} />
              </BarChart>
            ) : (
              // 30 天用柱会挤成一片，改折线，缺口（未知热量）自然断开。
              <LineChart data={chartData}>
                <CartesianGrid vertical={false} stroke="#e8ebe5" />
                <XAxis dataKey="date" axisLine={false} tickLine={false} interval="preserveStartEnd" />
                <YAxis axisLine={false} tickLine={false} />
                <Tooltip />
                <Line
                  type="monotone"
                  dataKey="calories"
                  name="热量 kcal"
                  stroke="#d9a441"
                  strokeWidth={2.5}
                  dot={{ r: 2.5 }}
                  connectNulls={false}
                />
              </LineChart>
            )}
            </ResponsiveContainer>
          ) : (
            <div className="empty-chart">
              <Flame size={24} />
              <span>区间内还没有热量已知的记录</span>
            </div>
          )}
        </div>
        <p className="chart-note">未记录或热量不全的日子留空，不画成 0。</p>
      </section>

      <section className="card review-notes">
        <div className="card-heading compact">
          <div>
            <p className="eyebrow">确定性规则 · 不接模型</p>
            <h2>复盘提示</h2>
          </div>
          <span className="calendar-total">{metrics.judgedDays} 天可判定</span>
        </div>
        <ul className="notes-list">
          {review.verdicts.map((verdict) => (
            <li key={verdict.title} className={`note-${verdict.level}`}>
              <span className="note-icon">
                {verdict.level === "warn" ? <AlertTriangle size={16} /> : verdict.level === "ok" ? <Check size={16} /> : <Info size={16} />}
              </span>
              <div>
                <strong>{verdict.title}</strong>
                <p>{verdict.detail}</p>
              </div>
            </li>
          ))}
        </ul>
        <p className="review-disclaimer">
          以上均为基于已有记录的算术结果，不构成健康评估，也不会自动修改你的目标。目标与方案由你自己决定。
        </p>
      </section>
    </div>
  );
}

function Metric({
  icon,
  label,
  value,
  note,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  note?: string;
  tone?: "up" | "down";
}) {
  return (
    <article className="metric-card icon-metric">
      <span className="metric-icon">{icon}</span>
      <div>
        <span>{label}</span>
        <strong className={tone === "down" ? "metric-down" : tone === "up" ? "metric-up" : undefined}>{value}</strong>
        {note && <small>{note}</small>}
      </div>
    </article>
  );
}
