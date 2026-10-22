import { useMemo, useState } from "react";
import { daySpan, diaryToday, shiftDiaryDate, type DiaryDateProps } from "../domain/diary";
import { DiaryDateControl } from "../components/DiaryDateControl";
import {
  Activity,
  AlertTriangle,
  CalendarCheck,
  Check,
  Dumbbell,
  Flame,
  Info,
  Ruler,
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
import { formatCm, formatPercent, formatWeight, girthDeltaText } from "../domain/body";
import { readTrendsRange, writeTrendsRange } from "../domain/preferences";

/** 自定义区间上限：再长就不是「阶段复盘」了；也顺带挡住误输入的天文数字。 */
export const MAX_CUSTOM_DAYS = 92;

/** 输入即收窄：结束不晚于今天，开始不晚于结束、不早于「结束 − 91 天」，保证 span 永远 ≤ 上限。 */
export function clampRange(start: string, end: string) {
  const today = diaryToday();
  const safeEnd = end > today ? today : end;
  let safeStart = start > safeEnd ? safeEnd : start;
  const floor = shiftDiaryDate(safeEnd, -(MAX_CUSTOM_DAYS - 1));
  if (safeStart < floor) safeStart = floor;
  return { start: safeStart, end: safeEnd };
}

/** 点日历格跳去哪一页。默认饮食；不记忆，免得「默认」名存实亡。 */
export type CalendarTarget = "food" | "body" | "workout";

const CALENDAR_TARGETS: { value: CalendarTarget; label: string; selectLabel: string }[] = [
  { value: "food", label: "饮食", selectLabel: "饮食记录" },
  { value: "body", label: "身体", selectLabel: "身体记录" },
  { value: "workout", label: "运动", selectLabel: "运动记录" },
];

export function TrendsPage({
  date = diaryToday(),
  onDateChange,
  goTo,
}: DiaryDateProps & { goTo?: (page: string) => void } = {}) {
  // 偏好只在挂载时读一次；存下的 end 可能晚于今天、start 可能早于 92 天，所以先过 clampRange。
  const [initialRange] = useState(readTrendsRange);
  const [rangeDays, setRangeDays] = useState<RangePreset>(
    initialRange.mode === "preset" ? initialRange.days : 7,
  );
  // null = 用预设档位；有值 = 用户自己指定的起止日（与日记日解耦）。
  const [custom, setCustom] = useState<{ start: string; end: string } | null>(() =>
    initialRange.mode === "custom" ? clampRange(initialRange.start, initialRange.end) : null,
  );
  const [calendarTarget, setCalendarTarget] = useState<CalendarTarget>("food");
  const start = custom ? custom.start : shiftDiaryDate(date, -(rangeDays - 1));
  const end = custom ? custom.end : date;
  const spanDays = Math.max(1, daySpan(start, end));

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
    for (let offset = 0; offset < spanDays; offset += 1) {
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
  }, [period.data, meals, checkIns, workouts, start, spanDays]);

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
              className={!custom && preset === rangeDays ? "active" : ""}
              aria-pressed={!custom && preset === rangeDays}
              onClick={() => {
                setCustom(null);
                setRangeDays(preset);
                writeTrendsRange({ mode: "preset", days: preset });
              }}
            >
              {preset} 天
            </button>
          ))}
          <button
            type="button"
            className={custom ? "active" : ""}
            aria-pressed={!!custom}
            onClick={() => {
              const next = { start, end };
              setCustom(next);
              writeTrendsRange({ mode: "custom", ...next });
            }}
          >
            自定义
          </button>
        </div>
      </div>

      {custom && (
        <div className="range-custom">
          <label>
            <span>开始</span>
            <input
              type="date"
              value={custom.start}
              max={custom.end}
              onChange={(event) => {
                const next = clampRange(event.target.value, custom.end);
                setCustom(next);
                writeTrendsRange({ mode: "custom", ...next });
              }}
            />
          </label>
          <label>
            <span>结束</span>
            <input
              type="date"
              value={custom.end}
              min={custom.start}
              max={diaryToday()}
              onChange={(event) => {
                const next = clampRange(custom.start, event.target.value);
                setCustom(next);
                writeTrendsRange({ mode: "custom", ...next });
              }}
            />
          </label>
          <span className="calendar-hint">最长 {MAX_CUSTOM_DAYS} 天，超出会自动收窄。</span>
          <button
            className="text-button"
            type="button"
            onClick={() => {
              setCustom(null);
              writeTrendsRange({ mode: "preset", days: rangeDays });
            }}
          >
            回到 {rangeDays} 天预设
          </button>
        </div>
      )}

      <p className="form-hint">
        统计区间 {start} 至 {end}（{spanDays} 天）。日均只使用「已确认 + 有餐次 + 热量全部已知」的完整日，缺失的日子不会按 0 摊薄。
      </p>

      <div className="metric-row five">
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
          icon={<Ruler />}
          label="区间腰围变化"
          value={
            metrics.waist === null
              ? "区间内未量"
              : metrics.waist.change === null
                ? formatCm(metrics.waist.latest)
                : girthDeltaText(metrics.waist.change, " cm")
          }
          tone={
            metrics.waist?.change == null || metrics.waist.change === 0
              ? undefined
              : metrics.waist.change < 0
                ? "down"
                : "up"
          }
          note={
            metrics.waist === null
              ? "在「身体」页记一次腰围"
              : metrics.waist.change === null
                ? `${metrics.waist.latestDate.slice(5)} 只有一次`
                : `最新 ${formatCm(metrics.waist.latest)}${
                    metrics.bodyFat ? ` · 体脂 ${formatPercent(metrics.bodyFat.latest)}` : ""
                  }`
          }
        />
        <Metric
          icon={<Dumbbell />}
          label="区间运动"
          value={`${metrics.workoutCount} 次`}
          note={`共 ${Math.round(metrics.workoutMinutes)} 分钟 · 不抵扣饮食`}
        />
      </div>

      <WeeklyDeltaGauge delta={metrics.weeklyDelta} minRate={metrics.safeMinRate} maxRate={metrics.safeMaxRate} />

      <ReviewCalendar
        cells={review.calendar}
        selectLabel={CALENDAR_TARGETS.find((item) => item.value === calendarTarget)!.selectLabel}
        headerAction={
          goTo ? (
            <div className="range-tabs calendar-target" role="group" aria-label="日历格跳转到">
              {CALENDAR_TARGETS.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  className={item.value === calendarTarget ? "active" : ""}
                  aria-pressed={item.value === calendarTarget}
                  onClick={() => setCalendarTarget(item.value)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          ) : undefined
        }
        onSelect={(day) => {
          // 点某天＝把日记日切到那天，再跳到用户选的那一页，省掉「记住日期再自己翻」。
          onDateChange?.(day);
          goTo?.(calendarTarget);
        }}
      />

      <section className="card chart-card">
        <div className="card-heading compact">
          <div>
            <p className="eyebrow">图示摄入 · 完整日计均值</p>
            <h2>{spanDays} 天热量</h2>
          </div>
        </div>
        <div className="chart-large">
          {chartData.some((item) => item.calories !== null) ? (
            <ResponsiveContainer width="100%" height="100%">
              {spanDays <= 14 ? (
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
