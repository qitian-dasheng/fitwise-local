import { useEffect, useState } from "react";
import { Activity, CalendarCheck, ChevronLeft, ChevronRight, Percent, Ruler, Scale } from "lucide-react";
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { WeightCorrectionModal } from "../components/WeightCorrectionModal";
import { WeightHistoryTable } from "../components/WeightHistoryTable";
import { useConfirmedAction } from "../components/useConfirmedAction";
import {
  MEASUREMENT_CONDITION_OPTIONS,
  MEASUREMENT_NOTE_LIMIT,
  dailyRepresentatives,
  formatCm,
  formatPercent,
  formatWeight,
  girthDeltaText,
  latestCircumference,
  shanghaiNowParts,
  validateBodyFatInput,
  validateWaistInput,
  validateWeightInput,
  weightDelta,
} from "../domain/body";
import { movingAverage } from "../domain/calculations";
import { diaryToday, shiftDiaryDate, type DiaryDateProps } from "../domain/diary";
import type { BodyMeasurement, MeasurementCondition } from "../domain/types";
import { usePeriodSummary } from "../data/domainQueries";
import { useAppStore } from "../store/appStore";

type Correction = { measurement: BodyMeasurement; mode: "edit" | "void" } | null;

export function BodyPage({ date = diaryToday(), onDateChange }: DiaryDateProps = {}) {
  const measurements = useAppStore((state) => state.measurements);
  const profile = useAppStore((state) => state.profile);
  const recordWeight = useAppStore((state) => state.recordWeight);
  const setWeightRepresentative = useAppStore((state) => state.setWeightRepresentative);
  const [correction, setCorrection] = useState<Correction>(null);
  const action = useConfirmedAction();

  const now = shanghaiNowParts();
  const [form, setForm] = useState({
    date,
    time: now.time,
    condition: "morning" as MeasurementCondition,
    weight: "",
    waist: "",
    bodyFat: "",
    note: "",
  });
  // OBS-015：顶部切换日记日期时，尚未填写的表单跟随到所选日，避免补录误存为今天。
  useEffect(() => {
    setForm((current) =>
      current.weight.trim() || current.waist.trim() || current.bodyFat.trim() || current.note.trim()
        ? current
        : { ...current, date },
    );
  }, [date]);

  const parsed = validateWeightInput(form.weight);
  const weightError = form.weight.trim() ? parsed.error : undefined;
  // 围度与体脂可留空：留空就真的不写字段，不能落一个 0。
  const parsedWaist = validateWaistInput(form.waist);
  const parsedBodyFat = validateBodyFatInput(form.bodyFat);
  const girthError = parsedWaist.error ?? parsedBodyFat.error;

  const start = shiftDiaryDate(date, -6);
  const period = usePeriodSummary(start, date);
  // OBS-013：图表窗口比指标宽（14 天），一周只称一次也能看到点；指标行仍按 7 日口径。
  const chartStart = shiftDiaryDate(date, -13);
  const chartPeriod = usePeriodSummary(chartStart, date);
  const representatives = dailyRepresentatives(measurements.filter((item) => item.date <= date));

  const chartData = chartPeriod.data
    ? chartPeriod.data.measurements.map((item) => ({ date: item.date.slice(5), weight: item.weightKg, average: item.average }))
    : (() => {
        const points = representatives.filter((item) => item.date >= chartStart).map((item) => ({ date: item.date, value: item.weightKg }));
        const averaged = movingAverage(points);
        return points.map((point, index) => ({
          date: point.date.slice(5),
          weight: point.value,
          average: averaged[index]?.value ?? point.value,
        }));
      })();
  const chartLoading = chartPeriod.loading && chartData.length === 0;
  // 纵轴范围把目标线也算进去，目标线落在数据范围外时不至于被裁掉。
  const chartValues = chartData.flatMap((point) => [point.weight, point.average]);
  if (profile.targetWeightKg > 0) chartValues.push(profile.targetWeightKg);
  const yDomain: [number, number] = chartValues.length
    ? [Math.min(...chartValues) - 1, Math.max(...chartValues) + 1]
    : [40, 100];

  const latest = period.data ? period.data.latestWeightKg : representatives.at(-1)?.weightKg ?? null;
  const sevenDayAverage = representatives.length
    ? representatives.filter((item) => item.date >= start).reduce((sum, item) => sum + item.weightKg, 0) /
      Math.max(1, representatives.filter((item) => item.date >= start).length)
    : null;
  const sevenDayBase = representatives.find((item) => item.date <= start)?.weightKg ?? representatives[0]?.weightKg;
  const sevenDayChange = latest !== null && sevenDayBase !== undefined ? weightDelta(latest, sevenDayBase) : "—";
  // 「持平」和「—」都是文案，不能拼上 kg 单位。
  const sevenDayChangeText = /^[+-]/.test(sevenDayChange) ? `${sevenDayChange} kg` : sevenDayChange;
  const toTarget = latest !== null ? latest - profile.targetWeightKg : null;
  const waist = latestCircumference(measurements, "waistCm", date);
  const bodyFat = latestCircumference(measurements, "bodyFatPercent", date);
  // 围度/体脂各自的迷你趋势：按日取最新值，只画有记录的区间（0.4.10 缺口补齐）。
  const circumferenceSeries = (key: "waistCm" | "bodyFatPercent") => {
    const byDate = new Map<string, { createdAt: string; value: number }>();
    for (const item of measurements) {
      if (item.date > date || item.status === "void" || item.status === "superseded") continue;
      const value = item[key];
      if (typeof value !== "number") continue;
      const current = byDate.get(item.date);
      if (!current || item.createdAt >= current.createdAt) byDate.set(item.date, { createdAt: item.createdAt, value });
    }
    return [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, entry]) => ({ date: day.slice(5), value: entry.value }));
  };
  const waistSeries = circumferenceSeries("waistCm");
  const fatSeries = circumferenceSeries("bodyFatPercent");

  return (
    <div className="page body-page" style={{ display: "flex", flexDirection: "column", gap: 13, flex: 1, minHeight: 0 }}>
      <header className="ui-page-head">
        <div>
          <div className="date">身体记录 · 同一天可多次，趋势取当日最新</div>
          <h1>身体</h1>
        </div>
        <div className="actions" style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div className="ui-datestrip">
            <button className="ui-navbtn" aria-label="前一天" onClick={() => onDateChange?.(shiftDiaryDate(date, -1))}><ChevronLeft size={15} /></button>
            <input type="date" aria-label="查看日期" value={date} onChange={(event) => event.target.value && onDateChange?.(event.target.value)} style={{ all: "unset", cursor: "pointer", font: "inherit", color: "var(--ui-ink-2)" }} />
            <button className="ui-navbtn" aria-label="后一天" disabled={date >= diaryToday()} onClick={() => onDateChange?.(shiftDiaryDate(date, 1))}><ChevronRight size={15} /></button>
          </div>
        </div>
      </header>
      <p className="ui-chart-foot" style={{ marginTop: 0, paddingTop: 0 }}>统计区间 {start} 至 {date}。旧记录没有保存称重时刻时显示「未标注」，不会拿入库时间顶替。</p>

      <section className="ui-card body-entry">
        <div className="ui-panel-head">
          <h2>记录一次称重</h2>
          <span className="ui-badge flat">两位小数 · 两次称重之间不要更换衣着与时间</span>
        </div>
        <form
          className="body-entry-form"
          onSubmit={async (event) => {
            event.preventDefault();
            if (parsed.error || girthError) return;
            const input = {
              weightKg: parsed.value!,
              date: form.date,
              ...(form.time ? { time: form.time } : {}),
              condition: form.condition,
              ...(parsedWaist.value !== undefined ? { waistCm: parsedWaist.value } : {}),
              ...(parsedBodyFat.value !== undefined ? { bodyFatPercent: parsedBodyFat.value } : {}),
              ...(form.note.trim() ? { note: form.note.trim() } : {}),
            };
            const result = await action.run(JSON.stringify(input), (id) => recordWeight(input, id));
            if (!result.error) {
              setForm((current) => ({ ...current, weight: "", waist: "", bodyFat: "", note: "" }));
              const extras = [
                parsedWaist.value !== undefined ? `腰围 ${formatCm(parsedWaist.value)}` : null,
                parsedBodyFat.value !== undefined ? `体脂 ${formatPercent(parsedBodyFat.value)}` : null,
              ].filter(Boolean);
              action.setMessage(
                result.isOutlier
                  ? `已记录 ${formatWeight(input.weightKg)} kg；与最近记录相差较大，已保留原始值，请复核称量。`
                  : `已记录 ${formatWeight(input.weightKg)} kg${extras.length ? `，${extras.join("、")}` : ""}。`,
              );
            }
          }}
        >
          <fieldset className="library-fields" disabled={action.busy}>
            <label>
              <span>称重日期</span>
              <input
                type="date"
                required
                max={diaryToday()}
                value={form.date}
                onChange={(event) => setForm({ ...form, date: event.target.value })}
              />
            </label>
            <label>
              <span>称重时刻</span>
              <input
                type="time"
                value={form.time}
                onChange={(event) => setForm({ ...form, time: event.target.value })}
              />
            </label>
            <label>
              <span>称重条件</span>
              <select
                value={form.condition}
                onChange={(event) => setForm({ ...form, condition: event.target.value as MeasurementCondition })}
              >
                {MEASUREMENT_CONDITION_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <label>
              <span>体重（kg）</span>
              <input
                type="number"
                inputMode="decimal"
                required
                min={20}
                max={400}
                step="0.01"
                placeholder="例如 82.60"
                value={form.weight}
                onChange={(event) => setForm({ ...form, weight: event.target.value })}
              />
            </label>
            <label>
              <span>腰围（cm，可留空）</span>
              <input
                type="number"
                inputMode="decimal"
                min={40}
                max={200}
                step="0.1"
                placeholder="例如 92.5"
                value={form.waist}
                onChange={(event) => setForm({ ...form, waist: event.target.value })}
              />
            </label>
            <label>
              <span>体脂率（%，可留空）</span>
              <input
                type="number"
                inputMode="decimal"
                min={3}
                max={70}
                step="0.1"
                placeholder="例如 24.3"
                value={form.bodyFat}
                onChange={(event) => setForm({ ...form, bodyFat: event.target.value })}
              />
            </label>
            <label className="body-entry-note">
              <span>备注（可选）</span>
              <input
                maxLength={MEASUREMENT_NOTE_LIMIT}
                placeholder="例如 起床后未进食"
                value={form.note}
                onChange={(event) => setForm({ ...form, note: event.target.value })}
              />
            </label>
            <button className="button primary" type="submit" disabled={action.busy || !!parsed.error || !!girthError}>
              {action.busy ? "正在保存…" : "记录这次称重"}
            </button>
          </fieldset>
          {weightError && <p className="form-error" role="alert">{weightError}</p>}
          {girthError && <p className="form-error" role="alert">{girthError}</p>}
          {action.message && <p className="form-success" role="status">{action.message}</p>}
        </form>
      </section>

      <div className="metric-row five">
        <Metric
          icon={<Scale />}
          label="最新体重"
          value={latest === null ? "—" : `${formatWeight(latest)} kg`}
          note={toTarget === null ? "取所选日之前最近一次" : `距目标 ${profile.targetWeightKg} kg 还差 ${formatWeight(Math.abs(toTarget))} kg`}
        />
        <Metric icon={<Activity />} label="七日平均" value={sevenDayAverage === null ? "—" : `${formatWeight(sevenDayAverage)} kg`} note="每天只算一个代表值" />
        <Metric icon={<CalendarCheck />} label="七日变化" value={sevenDayChangeText} note="与区间起点比较" />
        <Metric
          icon={<Ruler />}
          label="最新腰围"
          value={waist === null ? "—" : formatCm(waist.latest)}
          note={
            waist === null
              ? "还没有腰围记录"
              : waist.change === null
                ? `记录于 ${waist.latestDate.slice(5)}`
                : `较上次 ${girthDeltaText(waist.change, " cm")}`
          }
        />
        <Metric
          icon={<Percent />}
          label="最新体脂"
          value={bodyFat === null ? "—" : formatPercent(bodyFat.latest)}
          note={
            bodyFat === null
              ? "还没有体脂记录"
              : bodyFat.change === null
                ? `记录于 ${bodyFat.latestDate.slice(5)}`
                : `较上次 ${girthDeltaText(bodyFat.change, "%")}`
          }
        />
      </div>

      <section className="ui-card chart-card">
        <div className="ui-panel-head">
          <h2>体重趋势</h2>
          <span>近 14 天 · 虚线为每次称重，实线为七日移动平均</span>
        </div>
        <div className="chart-large">
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="bodyWeightFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stopColor="var(--ui-ink)" stopOpacity={0.25} />
                    <stop offset="1" stopColor="var(--ui-ink)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="var(--ui-line)" />
                <XAxis dataKey="date" axisLine={false} tickLine={false} />
                <YAxis domain={yDomain} axisLine={false} tickLine={false} />
                <Tooltip />
                {/* 只有一个点时面积线会隐形，散点必须保留标记 */}
                <Area type="monotone" dataKey="weight" stroke="var(--ui-faint)" fill="none" strokeDasharray="4 4" dot={{ r: 2.5 }} />
                <Area type="monotone" dataKey="average" stroke="var(--ui-ink)" strokeWidth={3} fill="url(#bodyWeightFill)" />
                {profile.targetWeightKg > 0 && (
                  <ReferenceLine
                    y={profile.targetWeightKg}
                    stroke="var(--ui-faint)"
                    strokeDasharray="6 4"
                    label={{ value: `目标 ${formatWeight(profile.targetWeightKg)} kg`, position: "insideTopRight", fontSize: 11, fill: "var(--ui-muted)" }}
                  />
                )}
              </AreaChart>
            </ResponsiveContainer>
          ) : chartPeriod.error ? (
            <div className="empty-chart">
              <Scale />
              <span>趋势读取失败，重新打开本页可重试</span>
            </div>
          ) : chartLoading ? (
            <div className="empty-chart">
              <Scale />
              <span>正在读取本地体重记录…</span>
            </div>
          ) : (
            <div className="empty-chart">
              <Scale />
              <span>近 14 天还没有称重记录，记录一次就能看到趋势</span>
            </div>
          )}
        </div>
        {chartPeriod.error && chartData.length > 0 && (
          <p className="form-hint" role="alert">趋势读取失败，图示为本地缓存数据；重新打开本页可重试。</p>
        )}
      </section>

      {(waistSeries.length > 0 || fatSeries.length > 0) && (
        <div className="girth-grid">
          {waistSeries.length > 0 && (
            <section className="card chart-card girth-card">
              <div className="card-heading compact">
                <div>
                  <p className="eyebrow">按日最新一次</p>
                  <h2>腰围趋势</h2>
                </div>
                <span className="status-pill neutral">最新 {formatCm(waist!.latest)}</span>
              </div>
              <div className="chart-large girth-chart">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={waistSeries}>
                    <CartesianGrid vertical={false} stroke="var(--ui-line)" />
                    <XAxis dataKey="date" axisLine={false} tickLine={false} />
                    <YAxis domain={["dataMin - 1", "dataMax + 1"]} axisLine={false} tickLine={false} />
                    <Tooltip />
                    <Area type="monotone" dataKey="value" name="腰围 cm" stroke="var(--ui-ink)" strokeWidth={2.5} fill="none" dot={{ r: 2 }} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </section>
          )}
          {fatSeries.length > 0 && (
            <section className="card chart-card girth-card">
              <div className="card-heading compact">
                <div>
                  <p className="eyebrow">按日最新一次</p>
                  <h2>体脂趋势</h2>
                </div>
                <span className="status-pill neutral">最新 {formatPercent(bodyFat!.latest)}</span>
              </div>
              <div className="chart-large girth-chart">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={fatSeries}>
                    <CartesianGrid vertical={false} stroke="var(--ui-line)" />
                    <XAxis dataKey="date" axisLine={false} tickLine={false} />
                    <YAxis domain={["dataMin - 1", "dataMax + 1"]} axisLine={false} tickLine={false} />
                    <Tooltip />
                    <Area type="monotone" dataKey="value" name="体脂 %" stroke="var(--ui-ink)" strokeWidth={2.5} fill="none" dot={{ r: 2 }} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </section>
          )}
        </div>
      )}

      <WeightHistoryTable
        measurements={measurements}
        onEdit={(measurement) => setCorrection({ measurement, mode: "edit" })}
        onVoid={(measurement) => setCorrection({ measurement, mode: "void" })}
        onSetRepresentative={(measurement) => {
          void setWeightRepresentative(measurement.id);
        }}
      />

      {correction && (
        <WeightCorrectionModal
          measurement={correction.measurement}
          mode={correction.mode}
          onClose={() => setCorrection(null)}
        />
      )}
    </div>
  );
}

function Metric({ icon, label, value, note }: { icon: React.ReactNode; label: string; value: string; note: string }) {
  return (
    <article className="metric-card icon-metric">
      <span className="metric-icon">{icon}</span>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{note}</small>
      </div>
    </article>
  );
}
