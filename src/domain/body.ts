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
