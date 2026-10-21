import { useState } from "react";
import { Activity, CalendarCheck, Percent, Ruler, Scale } from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { DiaryDateControl } from "../components/DiaryDateControl";
import { PageHeader } from "../components/PageHeader";
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
  const parsed = validateWeightInput(form.weight);
  const weightError = form.weight.trim() ? parsed.error : undefined;
  // 围度与体脂可留空：留空就真的不写字段，不能落一个 0。
  const parsedWaist = validateWaistInput(form.waist);
  const parsedBodyFat = validateBodyFatInput(form.bodyFat);
  const girthError = parsedWaist.error ?? parsedBodyFat.error;

  const start = shiftDiaryDate(date, -6);
  const period = usePeriodSummary(start, date);
  const representatives = dailyRepresentatives(measurements.filter((item) => item.date <= date));

  const chartData = period.data
    ? period.data.measurements.map((item) => ({ date: item.date.slice(5), weight: item.weightKg, average: item.average }))
    : (() => {
        const points = representatives.filter((item) => item.date >= start).map((item) => ({ date: item.date, value: item.weightKg }));
        const averaged = movingAverage(points);
        return points.map((point, index) => ({
          date: point.date.slice(5),
          weight: point.value,
          average: averaged[index]?.value ?? point.value,
        }));
      })();

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

  if (period.loading || period.error) {
    return (
      <div className="page body-page">
        <PageHeader
          eyebrow="身体记录"
          title="身体"
          description={period.error ? "读取体重趋势失败，请重新打开此页面后重试。" : "正在读取本地体重记录…"}
        />
        {period.error && <p className="form-error" role="alert">{period.error}</p>}
      </div>
    );
  }

  return (
    <div className="page body-page">
      <PageHeader
        eyebrow="身体记录"
        title="身体"
        description="同一天可以记录多次；趋势默认取当日最新一次，也可以手动指定当天代表值。"
      />
      <DiaryDateControl date={date} onChange={onDateChange} />
      <p className="form-hint">统计区间 {start} 至 {date}。旧记录没有保存称重时刻时显示「未标注」，不会拿入库时间顶替。</p>

      <section className="card body-entry">
        <div className="card-heading compact">
          <div>
            <p className="eyebrow">两次称重之间不要更换衣着与时间</p>
            <h2>记录一次称重</h2>
          </div>
          <span className="status-pill neutral">两位小数</span>
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

      <section className="card chart-card">
        <div className="card-heading compact">
          <div>
            <p className="eyebrow">虚线为每次称重，实线为七日移动平均</p>
            <h2>七日体重趋势</h2>
          </div>
        </div>
        <div className="chart-large">
          {chartData.length > 1 ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="bodyWeightFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stopColor="#276a53" stopOpacity={0.25} />
                    <stop offset="1" stopColor="#276a53" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="#e8ebe5" />
                <XAxis dataKey="date" axisLine={false} tickLine={false} />
                <YAxis domain={["dataMin - 1", "dataMax + 1"]} axisLine={false} tickLine={false} />
                <Tooltip />
                <Area type="monotone" dataKey="weight" stroke="#b6bcb4" fill="none" strokeDasharray="4 4" />
                <Area type="monotone" dataKey="average" stroke="#276a53" strokeWidth={3} fill="url(#bodyWeightFill)" />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="empty-chart">
              <Scale />
              <span>再记录一次就能形成趋势</span>
            </div>
          )}
        </div>
      </section>

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
