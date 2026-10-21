import type { BodyMeasurement, MeasurementCondition } from "./types";
import { localShanghaiInput } from "./time";

/** 有效记录白名单：只有缺失 status 或显式 active 才算数。禁止用 != "superseded"。 */
export function isActiveMeasurement(measurement: BodyMeasurement) {
  return !measurement.status || measurement.status === "active";
}

export const MEASUREMENT_CONDITION_LABELS: Record<MeasurementCondition | "unspecified", string> = {
  morning: "晨起",
  other: "其他",
  unspecified: "未标注",
};

export const MEASUREMENT_CONDITION_OPTIONS: { value: MeasurementCondition; label: string }[] = [
  { value: "morning", label: "晨起" },
  { value: "other", label: "其他" },
];

export const WEIGHT_MIN_KG = 20;
export const WEIGHT_MAX_KG = 400;
export const MEASUREMENT_NOTE_LIMIT = 200;

/** 腰围与体脂都是可选字段：留空就是没量，不能伪装成 0。 */
export const WAIST_MIN_CM = 40;
export const WAIST_MAX_CM = 200;
export const BODY_FAT_MIN_PERCENT = 3;
export const BODY_FAT_MAX_PERCENT = 70;

/** 'YYYY-MM-DD' + 'HH:mm' → 'YYYY-MM-DDTHH:mm:00+08:00' */
export function makeMeasuredAt(date: string, time: string) {
  return `${date}T${time.length === 5 ? `${time}:00` : time}+08:00`;
}

/** 当前北京时间的 { date, time }，用于表单默认值。 */
export function shanghaiNowParts(value = new Date().toISOString()) {
  const local = localShanghaiInput(value);
  return { date: local.slice(0, 10), time: local.slice(11, 16) };
}

/** 只取称重时刻的 HH:mm；旧记录没有 measuredAt 时如实返回「未标注」，不拿 createdAt 冒充。 */
export function measurementTime(measurement: BodyMeasurement) {
  const stamp = measurement.measuredAt;
  if (!stamp || stamp.length < 16) return "未标注";
  return stamp.slice(11, 16);
}

export function measurementConditionLabel(measurement: BodyMeasurement) {
  return MEASUREMENT_CONDITION_LABELS[measurement.condition ?? "unspecified"];
}

/** 排序时间戳：优先 measuredAt，其次 createdAt；两者都没有时为 0。 */
export function measurementTimestamp(measurement: BodyMeasurement) {
  const stamp = measurement.measuredAt ?? measurement.createdAt;
  const parsed = stamp ? Date.parse(stamp) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

export function compareMeasurements(a: BodyMeasurement, b: BodyMeasurement) {
  const byDate = a.date.localeCompare(b.date);
  if (byDate !== 0) return byDate;
  const byTime = measurementTimestamp(a) - measurementTimestamp(b);
  if (byTime !== 0) return byTime;
  return a.id.localeCompare(b.id);
}

/** 有效记录按时间升序。 */
export function chronologicalMeasurements(list: BodyMeasurement[]) {
  return list.filter(isActiveMeasurement).slice().sort(compareMeasurements);
}

function pickRepresentative(group: BodyMeasurement[]) {
  return group.reduce((best, item) => {
    const itemFlag = item.dayRepresentative ? 1 : 0;
    const bestFlag = best.dayRepresentative ? 1 : 0;
    if (itemFlag !== bestFlag) return itemFlag > bestFlag ? item : best;
    const itemTime = measurementTimestamp(item);
    const bestTime = measurementTimestamp(best);
    if (itemTime !== bestTime) return itemTime > bestTime ? item : best;
    return item.id > best.id ? item : best;
  });
}

/**
 * 每日趋势代表值：只取 active，按 date 分组，组内优先 dayRepresentative，
 * 否则取时刻最新，再相同取 id 较大者。规则与 Rust/SQL 保持逐字一致。
 */
export function dailyRepresentatives(list: BodyMeasurement[]) {
  const groups = new Map<string, BodyMeasurement[]>();
  for (const item of list) {
    if (!isActiveMeasurement(item)) continue;
    const bucket = groups.get(item.date);
    if (bucket) bucket.push(item);
    else groups.set(item.date, [item]);
  }
  return [...groups.values()]
    .map(pickRepresentative)
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function formatWeight(kg: number) {
  return kg.toFixed(2);
}

/** 与上一条有效记录的差值；首条返回「—」，差值为零返回「持平」。 */
export function weightDelta(current: number, previous?: number) {
  if (previous === undefined || !Number.isFinite(previous)) return "—";
  const diff = Math.round((current - previous) * 100) / 100;
  if (Math.abs(diff) < 0.005) return "持平";
  return `${diff > 0 ? "+" : ""}${diff.toFixed(2)}`;
}

export function validateWeightInput(raw: string): { value?: number; error?: string } {
  const text = raw.trim();
  if (!text) return { error: "请填写体重。" };
  if (!/^\d+(\.\d+)?$/.test(text)) return { error: "体重只能是数字。" };
  const value = Number(text);
  if (!Number.isFinite(value)) return { error: "体重只能是数字。" };
  if (value < WEIGHT_MIN_KG || value > WEIGHT_MAX_KG) {
    return { error: `体重需在 ${WEIGHT_MIN_KG}–${WEIGHT_MAX_KG} kg 之间。` };
  }
  const decimals = text.includes(".") ? text.split(".")[1].length : 0;
  if (decimals > 2) return { error: "体重最多保留两位小数。" };
  return { value: Math.round(value * 100) / 100 };
}

/**
 * 可留空的围度校验：空串表示「这次没量」，返回空对象而不是报错。
 * 留空必须真的不写字段，不能落一个 0 到记录里——0 cm 腰围比没有腰围更误导。
 */
function validateOptionalDecimal(
  raw: string,
  options: { label: string; min: number; max: number; range: string; decimals: number },
): { value?: number; error?: string } {
  const { label, min, max, range, decimals } = options;
  const text = raw.trim();
  if (!text) return {};
  if (!/^\d+(\.\d+)?$/.test(text)) return { error: `${label}只能是数字。` };
  const value = Number(text);
  if (!Number.isFinite(value)) return { error: `${label}只能是数字。` };
  if (value < min || value > max) {
    return { error: `${label}需在 ${range} 之间。` };
  }
  const digits = text.includes(".") ? text.split(".")[1].length : 0;
  if (digits > decimals) {
    return { error: `${label}最多保留${decimals === 1 ? "一" : "两"}位小数。` };
  }
  const factor = 10 ** decimals;
  return { value: Math.round(value * factor) / factor };
}

export function validateWaistInput(raw: string) {
  return validateOptionalDecimal(raw, {
    label: "腰围",
    min: WAIST_MIN_CM,
    max: WAIST_MAX_CM,
    range: "40–200 cm",
    decimals: 1,
  });
}

export function validateBodyFatInput(raw: string) {
  return validateOptionalDecimal(raw, {
    label: "体脂率",
    min: BODY_FAT_MIN_PERCENT,
    max: BODY_FAT_MAX_PERCENT,
    range: "3%–70%",
    decimals: 1,
  });
}

/** 腰围一位小数、带单位。 */
export function formatCm(value: number) {
  return `${value.toFixed(1)} cm`;
}

export function formatPercent(value: number) {
  return `${value.toFixed(1)}%`;
}

/** 围度变化文案：涨带 +，降带 −，「持平」不带单位。 */
export function girthDeltaText(change: number, unit = "") {
  if (Math.abs(change) < 0.05) return "持平";
  return `${change > 0 ? "+" : ""}${change.toFixed(1)}${unit}`;
}

/** 围度的区间读数：最新一次、以及相对基线（区间前最近一次，没有则区间内第一条）的变化。 */
export interface CircumferenceMetric {
  latest: number;
  latestDate: string;
  change: number | null;
  baseDate: string | null;
}

export type CircumferenceKey = "waistCm" | "bodyFatPercent";

export interface CircumferencePoint {
  date: string;
  value: number;
}

/**
 * 围度序列：同一天多次记录时取最晚的一次，缺失该字段的记录直接跳过。
 * 围度不像体重那样有「当日代表值」概念，所以不套 dailyRepresentatives。
 */
export function circumferenceSeries(
  measurements: BodyMeasurement[],
  key: CircumferenceKey,
): CircumferencePoint[] {
  const byDate = new Map<string, CircumferencePoint>();
  for (const item of chronologicalMeasurements(measurements)) {
    const value = item[key];
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    byDate.set(item.date, { date: item.date, value });
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * 区间围度读数。区间内一次都没量过就返回 null——不把区间外的数字搬进来充数。
 * 基线取「区间开始前最近一次」，没有才退回区间内第一条；只有一个点时 change 为 null。
 */
export function circumferenceMetric(
  series: CircumferencePoint[],
  start: string,
  end: string,
): CircumferenceMetric | null {
  const inside = series.filter((point) => point.date >= start && point.date <= end);
  if (!inside.length) return null;
  const latest = inside[inside.length - 1];
  const before = [...series].reverse().find((point) => point.date < start);
  const base = before ?? inside[0];
  if (base.date === latest.date) {
    return { latest: latest.value, latestDate: latest.date, change: null, baseDate: null };
  }
  return {
    latest: latest.value,
    latestDate: latest.date,
    change: Math.round((latest.value - base.value) * 10) / 10,
    baseDate: base.date,
  };
}

/** 截至某日（含）的最新一次围度，身体页用它显示「最新腰围 / 最新体脂」。 */
export function latestCircumference(
  measurements: BodyMeasurement[],
  key: CircumferenceKey,
  endDate: string,
): CircumferenceMetric | null {
  const series = circumferenceSeries(measurements, key).filter((point) => point.date <= endDate);
  if (!series.length) return null;
  const latest = series[series.length - 1];
  const previous = series.length > 1 ? series[series.length - 2] : null;
  return {
    latest: latest.value,
    latestDate: latest.date,
    change: previous ? Math.round((latest.value - previous.value) * 10) / 10 : null,
    baseDate: previous?.date ?? null,
  };
}

/** 该条记录是其所在日期内第几次有效称重（1 起）；非有效记录返回 null。 */
export function sameDayIndex(list: BodyMeasurement[], target: BodyMeasurement) {
  if (!isActiveMeasurement(target)) return null;
  const sameDay = chronologicalMeasurements(list.filter((item) => item.date === target.date));
  const index = sameDay.findIndex((item) => item.id === target.id);
  return index < 0 ? null : index + 1;
}

export interface MeasurementRow {
  measurement: BodyMeasurement;
  delta: string;
  deltaTitle?: string;
  dayIndex: number | null;
  /** 该日期下的有效称重条数，用来判断要不要给「设为代表」入口。 */
  dayTotal: number;
  isRepresentative: boolean;
}

/**
 * 历史表逐行数据：全部记录（含已更正/已作废）按时间倒序，
 * 变化值只在有效行之间计算，作废与已更正行保留可查。
 */
export function measurementRows(list: BodyMeasurement[]): MeasurementRow[] {
  const active = chronologicalMeasurements(list);
  const deltaById = new Map<string, { text: string; title?: string }>();
  active.forEach((item, index) => {
    const previous = index > 0 ? active[index - 1] : undefined;
    deltaById.set(item.id, {
      text: weightDelta(item.weightKg, previous?.weightKg),
      title: previous
        ? `对比 ${previous.date.slice(5)} ${measurementTime(previous)} 的 ${formatWeight(previous.weightKg)} kg`
        : undefined,
    });
  });
  const representativeIds = new Set(dailyRepresentatives(list).map((item) => item.id));
  const dayTotals = new Map<string, number>();
  for (const item of active) {
    dayTotals.set(item.date, (dayTotals.get(item.date) ?? 0) + 1);
  }

  return list
    .slice()
    .sort((a, b) => compareMeasurements(b, a))
    .map((measurement) => {
      const delta = deltaById.get(measurement.id);
      return {
        measurement,
        delta: delta?.text ?? "—",
        deltaTitle: delta?.title,
        dayIndex: sameDayIndex(list, measurement),
        dayTotal: dayTotals.get(measurement.date) ?? 0,
        isRepresentative: representativeIds.has(measurement.id),
      };
    });
}
