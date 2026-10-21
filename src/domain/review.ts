/**
 * 阶段复盘的确定性计算。
 *
 * 这里的每个数字都是「基于已有记录的算术」，不构成健康评估，也不给医学建议。
 * 所有阈值都从 UserProfile 推导，不写死某个体重或热量，
 * 换人、换目标、换档位时不需要改代码。
 */

import { circumferenceMetric, circumferenceSeries, dailyRepresentatives, type CircumferenceMetric } from "./body";
import { shiftDiaryDate } from "./diary";
import type { BodyMeasurement, NutrientKey, UserProfile } from "./types";

/** 日历上的四种状态：无记录 / 有记录但热量不全 / 有记录未达标 / 达标。 */
export type ReviewDayStatus = "none" | "partial" | "miss" | "hit";

export interface ReviewDay {
  date: string;
  complete: boolean;
  mealCount: number;
  totals: Record<NutrientKey, number>;
  coverage: Record<NutrientKey, number>;
  workoutMinutes: number;
  workoutCount: number;
}

export interface CalendarCell {
  date: string;
  status: ReviewDayStatus;
  calories: number | null;
  protein: number | null;
  complete: boolean;
  workoutCount: number;
}

export interface ReviewMetrics {
  dayCount: number;
  recordedDays: number;
  completeDays: number;
  judgedDays: number;
  calorieHitDays: number;
  proteinHitDays: number;
  fiberHitDays: number;
  averageCalories: number | null;
  averageProtein: number | null;
  averageFiber: number | null;
  workoutMinutes: number;
  workoutCount: number;
  weightChange: number | null;
  latestWeightKg: number | null;
  toTargetKg: number | null;
  weeklyDelta: number | null;
  safeMinRate: number;
  safeMaxRate: number;
  /** 区间腰围：只在区间内确有测量时才有值，不拿区间外的数据冒充。 */
  waist: CircumferenceMetric | null;
  bodyFat: CircumferenceMetric | null;
}

export type ReviewLevel = "ok" | "warn" | "info";

export interface ReviewVerdict {
  level: ReviewLevel;
  title: string;
  detail: string;
}

export interface ReviewResult {
  metrics: ReviewMetrics;
  calendar: CalendarCell[];
  verdicts: ReviewVerdict[];
}

const RANGE_PRESETS = [7, 14, 30] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];
export { RANGE_PRESETS };

/** 滚动窗口的长度：本周 7 天 vs 前 7 天。 */
export const ROLLING_WINDOW_DAYS = 7;

/** 每段至少要有这么多天体重，才认为均值可信；1–2 个点算出来的「降幅」是噪声。 */
const MIN_POINTS_PER_WINDOW = 3;

/** 记录完整度低于这个比例时，趋势判断只作参考。 */
const COMPLETENESS_FLOOR = 0.7;

/** 热量偏离目标区间多少 kcal 以内不提示。 */
const CALORIE_TOLERANCE = 100;

/** 蛋白低于目标的这个比例才提示。 */
const PROTEIN_FLOOR_RATIO = 0.9;

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function average(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * 安全减重速率：当前体重的 0.5%–1.0% / 周。
 * 这个区间由体重推导，所以 83.8 kg 会得到约 0.42–0.84 kg/周，与小基数人群的绝对值不同。
 */
export function safeRateRange(referenceKg: number) {
  if (!Number.isFinite(referenceKg) || referenceKg <= 0) {
    return { minRate: 0, maxRate: 0 };
  }
  return {
    minRate: round2(referenceKg * 0.005),
    maxRate: round2(referenceKg * 0.01),
  };
}

/**
 * 严格的达标判定：热量必须落在目标区间内，蛋白必须达到目标。
 * 热量覆盖率不足 100% 时无法判定（宁可不判，也不把「未知」当成 0 去算）。
 */
export function dayStatus(day: ReviewDay | undefined, profile: UserProfile): ReviewDayStatus {
  if (!day || day.mealCount === 0) return "none";
  if ((day.coverage?.calories ?? 0) < 100) return "partial";
  const calories = day.totals?.calories ?? 0;
  const protein = day.totals?.protein ?? 0;
  const { min, max } = profile.dailyCalories;
  if (calories < min || calories > max) return "miss";
  if (protein < profile.proteinTargetG) return "miss";
  return "hit";
}

/** 该日是否达到「完整记录日」：已确认完成、有餐次、热量全部已知。 */
export function isCompleteRecordedDay(day: ReviewDay) {
  return day.complete && day.mealCount > 0 && (day.coverage?.calories ?? 0) >= 100;
}

/**
 * 滚动 7 天降幅 = 本周 7 天体重均值 − 前 7 天均值。
 * 下降为负数。两端各需至少 3 个称重日，否则返回 null。
 */
export function rollingDelta(
  measurements: BodyMeasurement[],
  endDate: string,
  windowDays = ROLLING_WINDOW_DAYS,
): number | null {
  const points = dailyRepresentatives(measurements).filter((item) => item.date <= endDate);
  const currentStart = shiftDiaryDate(endDate, -(windowDays - 1));
  const previousEnd = shiftDiaryDate(endDate, -windowDays);
  const previousStart = shiftDiaryDate(endDate, -(windowDays * 2 - 1));

  const current = points
    .filter((item) => item.date >= currentStart && item.date <= endDate)
    .map((item) => item.weightKg);
  const previous = points
    .filter((item) => item.date >= previousStart && item.date <= previousEnd)
    .map((item) => item.weightKg);

  if (current.length < MIN_POINTS_PER_WINDOW || previous.length < MIN_POINTS_PER_WINDOW) {
    return null;
  }
  return round2(average(current) - average(previous));
}

/** 区间首末代表值的净变化；不足两天记录返回 null。 */
export function rangeWeightChange(
  measurements: BodyMeasurement[],
  start: string,
  end: string,
): number | null {
  const points = dailyRepresentatives(measurements).filter(
    (item) => item.date >= start && item.date <= end,
  );
  if (points.length < 2) return null;
  return round2(points[points.length - 1].weightKg - points[0].weightKg);
}

/** 截至 endDate（含）的最新一次有效体重。 */
export function latestWeight(measurements: BodyMeasurement[], endDate: string): number | null {
  const points = dailyRepresentatives(measurements).filter((item) => item.date <= endDate);
  return points.length ? points[points.length - 1].weightKg : null;
}

function buildCalendar(days: ReviewDay[], profile: UserProfile): CalendarCell[] {
  return days.map((day) => {
    const status = dayStatus(day, profile);
    return {
      date: day.date,
      status,
      calories: day.mealCount > 0 && (day.coverage?.calories ?? 0) >= 100 ? round2(day.totals.calories ?? 0) : null,
      protein: day.mealCount > 0 && (day.coverage?.protein ?? 0) >= 100 ? round2(day.totals.protein ?? 0) : null,
      complete: day.complete,
      workoutCount: day.workoutCount ?? 0,
    };
  });
}

/** 把日子压成「10-19、10-20 等 3 天」，避免提示变成一长串日期。 */
function dateList(days: ReviewDay[], limit = 3) {
  const shown = days.slice(0, limit).map((day) => day.date.slice(5));
  const text = shown.join("、");
  return days.length > limit ? `${text} 等 ${days.length} 天` : text;
}

function verdictsFor(
  metrics: ReviewMetrics,
  days: ReviewDay[],
  profile: UserProfile,
): ReviewVerdict[] {
  const verdicts: ReviewVerdict[] = [];
  const { safeMinRate: minRate, safeMaxRate: maxRate } = metrics;
  const drop = metrics.weeklyDelta === null ? null : round2(-metrics.weeklyDelta);

  // 空区间不该被五条警告轮番教育：没有数据时只说明「还没记录」。
  const hasAnyData = days.some((day) => day.mealCount > 0) || metrics.latestWeightKg !== null;
  if (!hasAnyData) {
    return [
      {
        level: "info",
        title: "这段时间还没有记录",
        detail:
          "先在「饮食」记一餐、在「身体」称一次体重，这里就会按区间汇总。没有任何记录时不会给出任何结论，也不会把空白当成 0。",
      },
    ];
  }

  const completeness = metrics.dayCount > 0 ? metrics.completeDays / metrics.dayCount : 0;
  // 一条饮食都没有时，「不完整」是废话；只在确实开始记录后才提醒完整度。
  if (metrics.recordedDays > 0 && metrics.dayCount >= 7 && completeness < COMPLETENESS_FLOOR) {
    verdicts.push({
      level: "warn",
      title: "记录不够完整",
      detail: `区间内 ${metrics.completeDays} / ${metrics.dayCount} 天被标为完整（${Math.round(
        completeness * 100,
      )}%）。下面的日均与达标率只代表已记录的部分，缺口越大越容易看出假趋势。`,
    });
  }

  if (drop === null) {
    verdicts.push({
      level: "info",
      title: "周降幅暂不判断",
      detail: `本周与前一周各自需要有至少 ${MIN_POINTS_PER_WINDOW} 天体重记录才能比较。当前样本不足，先连续称几天再看。`,
    });
  } else if (drop > maxRate) {
    verdicts.push({
      level: "warn",
      title: "周降幅超过安全上限",
      detail: `近 ${ROLLING_WINDOW_DAYS} 天均值比前 ${ROLLING_WINDOW_DAYS} 天低 ${Math.abs(
        drop,
      ).toFixed(2)} kg，超过按当前体重 1% 推出的上限 ${maxRate.toFixed(2)} kg/周。降得太快通常意味着水分与肌肉一起掉，可考虑把每餐主食加回去一点。`,
    });
  } else if (drop >= minRate) {
    verdicts.push({
      level: "ok",
      title: "周降幅在安全速率内",
      detail: `近 ${ROLLING_WINDOW_DAYS} 天均值比前 ${ROLLING_WINDOW_DAYS} 天低 ${drop.toFixed(
        2,
      )} kg，落在 ${minRate.toFixed(2)}–${maxRate.toFixed(2)} kg/周的安全区间里。维持当前方案即可。`,
    });
  } else if (drop > 0) {
    verdicts.push({
      level: "info",
      title: "周降幅偏慢",
      detail: `近 ${ROLLING_WINDOW_DAYS} 天均值只比前一周低 ${drop.toFixed(2)} kg，低于按当前体重推出的下限 ${minRate.toFixed(
        2,
      )} kg/周。先确认热量与蛋白是否真的达标，再考虑调整。`,
    });
  } else {
    verdicts.push({
      level: "warn",
      title: "体重均值没有下降",
      detail: `近 ${ROLLING_WINDOW_DAYS} 天均值与前一周基本持平或更高。若饮食达标，常见原因是水分波动或记录不完整；连续两周如此再谈调整方案。`,
    });
  }

  if (metrics.averageCalories !== null) {
    const { min, max } = profile.dailyCalories;
    const average = Math.round(metrics.averageCalories);
    // 提示必须说清「超在哪几天」，只说日均超了，用户还得自己去翻日历。
    const knownDays = days.filter(
      (day) => day.mealCount > 0 && (day.coverage?.calories ?? 0) >= 100,
    );
    const overDays = knownDays.filter((day) => (day.totals.calories ?? 0) > max);
    const underDays = knownDays.filter((day) => (day.totals.calories ?? 0) < min);
    if (metrics.averageCalories > max + CALORIE_TOLERANCE) {
      verdicts.push({
        level: "warn",
        title: "日均热量超出目标",
        detail: `完整记录日的日均 ${average} kcal，高于目标上限 ${max} kcal。超出上限的有 ${dateList(
          overDays,
        )}。看看是否有一两餐份量偏大，或零食没有记进来。`,
      });
    } else if (metrics.averageCalories < min - CALORIE_TOLERANCE) {
      verdicts.push({
        level: "warn",
        title: "日均热量低于目标",
        detail: `完整记录日的日均 ${average} kcal，低于目标下限 ${min} kcal。低于下限的有 ${dateList(
          underDays,
        )}。缺口过大容易连带掉肌肉，也可能让后续更难坚持。`,
      });
    } else {
      verdicts.push({
        level: "ok",
        title: "日均热量在目标区间",
        detail: `完整记录日的日均 ${average} kcal，落在 ${min}–${max} kcal 之间${
          overDays.length + underDays.length > 0
            ? `；${overDays.length + underDays.length} 天在区间外（${dateList(
                [...overDays, ...underDays].sort((a, b) => a.date.localeCompare(b.date)),
              )}），但被日均抵消了`
            : ""
        }。`,
      });
    }
  }

  if (metrics.averageProtein !== null) {
    const target = profile.proteinTargetG;
    const average = Math.round(metrics.averageProtein);
    const knownDays = days.filter(
      (day) => day.mealCount > 0 && (day.coverage?.protein ?? 0) >= 100,
    );
    const shortDays = knownDays.filter((day) => (day.totals.protein ?? 0) < target);
    if (metrics.averageProtein < target * PROTEIN_FLOOR_RATIO) {
      verdicts.push({
        level: "warn",
        title: "蛋白摄入偏低",
        detail: `完整记录日的日均 ${average} g，比目标 ${target} g 少 ${Math.max(
          0,
          Math.round(target - metrics.averageProtein),
        )} g。没达到目标的有 ${dateList(
          shortDays,
        )}。优先从早餐蛋数或主餐肉量补，不要靠加工食品凑数。`,
      });
    } else if (metrics.averageProtein < target) {
      verdicts.push({
        level: "info",
        title: "蛋白接近目标",
        detail: `完整记录日的日均 ${average} g，距离目标 ${target} g 还差 ${Math.round(
          target - metrics.averageProtein,
        )} g。没达标的只有 ${dateList(shortDays)}，再加一个蛋或几口肉就能补上。`,
      });
    } else {
      verdicts.push({
        level: "ok",
        title: "蛋白达标",
        detail: `完整记录日的日均 ${average} g，达到目标 ${target} g${
          shortDays.length > 0 ? `；只有 ${dateList(shortDays)} 略低于目标` : ""
        }。减脂期维持这个水平有助于保住肌肉。`,
      });
    }
  }

  if (metrics.waist) {
    const { latest, change, baseDate } = metrics.waist;
    if (change === null) {
      verdicts.push({
        level: "info",
        title: "腰围只有一次记录",
        detail: `区间内只量到 ${latest.toFixed(1)} cm（${
          metrics.waist.latestDate
        }）。腰围要两条以上才能看变化，下次量的时候保持同一位置、同一时间、同一松紧。`,
      });
    } else if (change < 0) {
      verdicts.push({
        level: "ok",
        title: "腰围在下降",
        detail: `从 ${baseDate} 的基线到 ${metrics.waist.latestDate} 的 ${latest.toFixed(
          1,
        )} cm，减少了 ${Math.abs(change).toFixed(
          1,
        )} cm。腰围反映腹部脂肪，比体重更不容易被水分干扰，体重不动时它会先动。`,
      });
    } else if (change > 0) {
      verdicts.push({
        level: "info",
        title: "腰围没有下降",
        detail: `最新 ${latest.toFixed(1)} cm，比基线（${baseDate}）多 ${change.toFixed(
          1,
        )} cm。单次测量受位置与松紧影响很大，先确认量法一致；连续两次同向再当趋势看。`,
      });
    } else {
      verdicts.push({
        level: "info",
        title: "腰围持平",
        detail: `最新 ${latest.toFixed(1)} cm，与基线（${baseDate}）相同。体重下降时腰围持平通常是测量误差或水分，继续观察即可。`,
      });
    }
  }

  if (metrics.workoutCount === 0) {
    verdicts.push({
      level: "info",
      title: "区间内没有运动记录",
      detail: "运动消耗不会抵扣饮食额度，但它影响体重构成与精力。若这段时间确实没练，不用补记。",
    });
  } else {
    verdicts.push({
      level: "info",
      title: "运动记录",
      detail: `区间内 ${metrics.workoutCount} 次，共 ${Math.round(metrics.workoutMinutes)} 分钟。运动消耗只用于观察，不参与热量目标计算。`,
    });
  }

  if (metrics.toTargetKg !== null && metrics.toTargetKg > 0) {
    verdicts.push({
      level: "info",
      title: "距离目标体重",
      detail: `距 ${profile.targetWeightKg} kg 还差 ${metrics.toTargetKg.toFixed(2)} kg。按每周 ${minRate.toFixed(
        2,
      )}–${maxRate.toFixed(2)} kg 的安全速率估算，还需要一段时间，不要用极端缺口去换速度。`,
    });
  }

  if (metrics.recordedDays > 0 && metrics.judgedDays === 0) {
    verdicts.push({
      level: "info",
      title: "还没有可判定的达标日",
      detail: "热量未知的餐食会让当天无法判定达标。把营养补全后再看这一栏，比对着「未知」猜更可靠。",
    });
  }

  return verdicts;
}

export function buildReview(input: {
  days: ReviewDay[];
  measurements: BodyMeasurement[];
  profile: UserProfile;
  start: string;
  end: string;
}): ReviewResult {
  const { days, measurements, profile, start, end } = input;
  const statuses = days.map((day) => dayStatus(day, profile));
  const completeRecorded = days.filter(isCompleteRecordedDay);

  const weightChange = rangeWeightChange(measurements, start, end);
  const latestWeightKg = latestWeight(measurements, end);
  const reference = latestWeightKg ?? profile.startWeightKg;
  const { minRate, maxRate } = safeRateRange(reference);

  const metrics: ReviewMetrics = {
    dayCount: days.length,
    recordedDays: days.filter((day) => day.mealCount > 0).length,
    completeDays: days.filter((day) => day.complete).length,
    judgedDays: statuses.filter((status) => status === "hit" || status === "miss").length,
    calorieHitDays: statuses.filter((status) => status === "hit").length,
    proteinHitDays: days.filter(
      (day) =>
        day.mealCount > 0 &&
        (day.coverage?.protein ?? 0) >= 100 &&
        (day.totals.protein ?? 0) >= profile.proteinTargetG,
    ).length,
    fiberHitDays: days.filter(
      (day) =>
        day.mealCount > 0 &&
        (day.coverage?.fiber ?? 0) >= 100 &&
        (day.totals.fiber ?? 0) >= profile.fiberTargetG,
    ).length,
    averageCalories: completeRecorded.length
      ? average(completeRecorded.map((day) => day.totals.calories ?? 0))
      : null,
    averageProtein: completeRecorded.length
      ? average(completeRecorded.map((day) => day.totals.protein ?? 0))
      : null,
    averageFiber: completeRecorded.length
      ? average(completeRecorded.map((day) => day.totals.fiber ?? 0))
      : null,
    workoutMinutes: days.reduce((sum, day) => sum + (day.workoutMinutes ?? 0), 0),
    workoutCount: days.reduce((sum, day) => sum + (day.workoutCount ?? 0), 0),
    weightChange,
    latestWeightKg,
    toTargetKg:
      latestWeightKg === null ? null : round2(latestWeightKg - profile.targetWeightKg),
    weeklyDelta: rollingDelta(measurements, end),
    safeMinRate: minRate,
    safeMaxRate: maxRate,
    waist: circumferenceMetric(circumferenceSeries(measurements, "waistCm"), start, end),
    bodyFat: circumferenceMetric(circumferenceSeries(measurements, "bodyFatPercent"), start, end),
  };

  return {
    metrics,
    calendar: buildCalendar(days, profile),
    verdicts: verdictsFor(metrics, days, profile),
  };
}
