import { describe, expect, it } from "vitest";
import {
  buildReview,
  dayStatus,
  isCompleteRecordedDay,
  latestWeight,
  rangeWeightChange,
  rollingDelta,
  safeRateRange,
  type ReviewDay,
} from "../src/domain/review";
import type { BodyMeasurement, UserProfile } from "../src/domain/types";

const profile: UserProfile = {
  name: "测试",
  sex: "male",
  age: 22,
  heightCm: 172,
  startWeightKg: 83.8,
  targetWeightKg: 74,
  timezone: "Asia/Shanghai",
  dailyCalories: { min: 1950, target: 2000, max: 2050 },
  proteinTargetG: 160,
  fiberTargetG: 25,
  equipment: [],
};

function day(
  date: string,
  overrides: Partial<{
    calories: number;
    protein: number;
    fiber: number;
    coverageCalories: number;
    coverageProtein: number;
    coverageFiber: number;
    mealCount: number;
    complete: boolean;
    workoutMinutes: number;
    workoutCount: number;
  }> = {},
): ReviewDay {
  const {
    calories = 2000,
    protein = 165,
    fiber = 28,
    coverageCalories = 100,
    coverageProtein = 100,
    coverageFiber = 100,
    mealCount = 3,
    complete = true,
    workoutMinutes = 0,
    workoutCount = 0,
  } = overrides;
  return {
    date,
    complete,
    mealCount,
    workoutMinutes,
    workoutCount,
    totals: { calories, protein, carbohydrates: 200, fat: 60, fiber, sugar: 20, sodium: 2000 },
    coverage: {
      calories: coverageCalories,
      protein: coverageProtein,
      carbohydrates: 100,
      fat: 100,
      fiber: coverageFiber,
      sugar: 100,
      sodium: 100,
    },
  };
}

function measure(date: string, weightKg: number, extra: Partial<BodyMeasurement> = {}): BodyMeasurement {
  return {
    id: `${date}-${weightKg}`,
    date,
    weightKg,
    createdAt: `${date}T06:00:00+08:00`,
    ...extra,
  };
}

describe("dayStatus 严格达标判定", () => {
  it("没有餐次就是 none，不会被当成 0 卡", () => {
    expect(dayStatus(day("2026-10-19", { mealCount: 0 }), profile)).toBe("none");
  });

  it("热量覆盖率不足 100% 时无法判定，归为 partial", () => {
    expect(dayStatus(day("2026-10-19", { coverageCalories: 99 }), profile)).toBe("partial");
    expect(dayStatus(day("2026-10-19", { coverageCalories: 0, mealCount: 1 }), profile)).toBe("partial");
  });

  it("热量必须落在目标区间内，两端都算", () => {
    expect(dayStatus(day("2026-10-19", { calories: 1949 }), profile)).toBe("miss");
    expect(dayStatus(day("2026-10-19", { calories: 1950 }), profile)).toBe("hit");
    expect(dayStatus(day("2026-10-19", { calories: 2050 }), profile)).toBe("hit");
    expect(dayStatus(day("2026-10-19", { calories: 2051 }), profile)).toBe("miss");
  });

  it("蛋白按严格目标，不做 10% 宽限", () => {
    expect(dayStatus(day("2026-10-19", { protein: 159.9 }), profile)).toBe("miss");
    expect(dayStatus(day("2026-10-19", { protein: 160 }), profile)).toBe("hit");
  });

  it("热量或蛋白任一不达标就是 miss", () => {
    expect(dayStatus(day("2026-10-19", { calories: 3000, protein: 200 }), profile)).toBe("miss");
    expect(dayStatus(day("2026-10-19", { calories: 2000, protein: 100 }), profile)).toBe("miss");
  });
});

describe("isCompleteRecordedDay", () => {
  it("必须是已确认、有餐次、热量全部已知三者同时成立", () => {
    expect(isCompleteRecordedDay(day("2026-10-19"))).toBe(true);
    expect(isCompleteRecordedDay(day("2026-10-19", { complete: false }))).toBe(false);
    expect(isCompleteRecordedDay(day("2026-10-19", { mealCount: 0 }))).toBe(false);
    expect(isCompleteRecordedDay(day("2026-10-19", { coverageCalories: 80 }))).toBe(false);
  });
});

describe("safeRateRange 由体重推导", () => {
  it("83.8 kg 得到 0.42–0.84 kg/周", () => {
    expect(safeRateRange(83.8)).toEqual({ minRate: 0.42, maxRate: 0.84 });
  });

  it("更轻的体重安全速率绝对值更小", () => {
    const range = safeRateRange(70);
    expect(range.minRate).toBe(0.35);
    expect(range.maxRate).toBe(0.7);
  });

  it("无效体重不产出负数区间", () => {
    expect(safeRateRange(0)).toEqual({ minRate: 0, maxRate: 0 });
    expect(safeRateRange(Number.NaN)).toEqual({ minRate: 0, maxRate: 0 });
  });
});

describe("rollingDelta 滚动 7 天", () => {
  const end = "2026-10-21";

  it("两端样本不足时返回 null，不用 1–2 个点编造降幅", () => {
    expect(rollingDelta([], end)).toBeNull();
    expect(rollingDelta([measure("2026-10-20", 83.0), measure("2026-10-21", 82.9)], end)).toBeNull();
    expect(
      rollingDelta(
        [
          measure("2026-10-19", 83.0),
          measure("2026-10-20", 82.9),
          measure("2026-10-21", 82.8),
        ],
        end,
      ),
    ).toBeNull();
  });

  it("两段各 3 天时算出降幅（下降为负）", () => {
    const measurements = [
      measure("2026-10-08", 84.0),
      measure("2026-10-10", 84.0),
      measure("2026-10-12", 84.0),
      measure("2026-10-15", 83.4),
      measure("2026-10-17", 83.4),
      measure("2026-10-19", 83.4),
    ];
    expect(rollingDelta(measurements, end)).toBe(-0.6);
  });

  it("体重上升时返回正数", () => {
    const measurements = [
      measure("2026-10-08", 83.0),
      measure("2026-10-10", 83.0),
      measure("2026-10-12", 83.0),
      measure("2026-10-15", 83.8),
      measure("2026-10-17", 83.8),
      measure("2026-10-19", 83.8),
    ];
    expect(rollingDelta(measurements, end)).toBe(0.8);
  });

  it("同日多次称重只按当日代表值算一次", () => {
    const measurements = [
      measure("2026-10-08", 84.0),
      measure("2026-10-10", 84.0),
      measure("2026-10-12", 84.0),
      measure("2026-10-15", 83.0, { id: "a", createdAt: "2026-10-15T06:00:00+08:00" }),
      measure("2026-10-15", 90.0, { id: "b", createdAt: "2026-10-15T21:00:00+08:00" }),
      measure("2026-10-17", 83.0),
      measure("2026-10-19", 83.0),
    ];
    // 当日代表值取时刻最新，即 90.0；若不去重，本周均会被额外的 83.0 拉低。
    const delta = rollingDelta(measurements, end);
    expect(delta).not.toBeNull();
    expect(delta).toBeCloseTo(1.33, 1);
  });

  it("已作废的称重不参与计算", () => {
    const measurements = [
      measure("2026-10-08", 84.0),
      measure("2026-10-10", 84.0),
      measure("2026-10-12", 84.0),
      measure("2026-10-15", 83.4),
      measure("2026-10-17", 83.4),
      measure("2026-10-19", 83.4),
      measure("2026-10-20", 60.0, { status: "void" }),
      measure("2026-10-21", 60.0, { status: "superseded" }),
    ];
    expect(rollingDelta(measurements, end)).toBe(-0.6);
  });
});

describe("区间体重变化与最新体重", () => {
  it("首末代表值之差；不足两天返回 null", () => {
    const measurements = [
      measure("2026-10-01", 84.4),
      measure("2026-10-15", 83.6),
      measure("2026-10-21", 83.0),
    ];
    expect(rangeWeightChange(measurements, "2026-10-01", "2026-10-21")).toBe(-1.4);
    expect(rangeWeightChange(measurements, "2026-10-01", "2026-10-01")).toBeNull();
  });

  it("最新体重只取截止日之前", () => {
    const measurements = [measure("2026-10-01", 84.4), measure("2026-10-25", 82.0)];
    expect(latestWeight(measurements, "2026-10-21")).toBe(84.4);
    expect(latestWeight(measurements, "2026-10-30")).toBe(82.0);
    expect(latestWeight([], "2026-10-21")).toBeNull();
  });
});

describe("buildReview 指标与判断", () => {
  const days = [
    day("2026-10-15", { calories: 2000, protein: 165 }),
    day("2026-10-16", { calories: 2100, protein: 165 }),
    day("2026-10-17", { calories: 1950, protein: 160 }),
    day("2026-10-18", { mealCount: 0, complete: false }),
    day("2026-10-19", { calories: 2000, protein: 165, complete: false }),
    day("2026-10-20", { calories: 2000, protein: 165, coverageCalories: 50, complete: false }),
    day("2026-10-21", { calories: 2000, protein: 165 }),
  ];

  it("达标天数按严格口径统计，空日与未知日不计入判定", () => {
    const result = buildReview({ days, measurements: [], profile, start: "2026-10-15", end: "2026-10-21" });
    // 可判定 = 10-15 / 10-16 / 10-17 / 10-19 / 10-21；10-18 无记录、10-20 热量未知。
    // 其中只有 10-16 超过目标上限，10-19 虽未确认完成但数值达标，仍算达标。
    expect(result.metrics.judgedDays).toBe(5);
    expect(result.metrics.calorieHitDays).toBe(4);
    expect(result.metrics.dayCount).toBe(7);
    expect(result.metrics.recordedDays).toBe(6);
  });

  it("日均只使用完整记录日，缺失的日子不会被当成 0 摊薄", () => {
    const result = buildReview({ days, measurements: [], profile, start: "2026-10-15", end: "2026-10-21" });
    // 完整日 = 10-15/16/17/21 → 2000+2100+1950+2000 = 8050 / 4
    expect(result.metrics.averageCalories).toBeCloseTo(2012.5, 2);
    expect(result.metrics.completeDays).toBe(4);
  });

  it("记录不完整时给出提醒", () => {
    const result = buildReview({ days, measurements: [], profile, start: "2026-10-15", end: "2026-10-21" });
    expect(result.verdicts.some((item) => item.title === "记录不够完整")).toBe(true);
  });

  it("体重样本不足时不判断周降幅", () => {
    const result = buildReview({ days, measurements: [], profile, start: "2026-10-15", end: "2026-10-21" });
    expect(result.metrics.weeklyDelta).toBeNull();
    const verdict = result.verdicts.find((item) => item.title === "周降幅暂不判断");
    expect(verdict?.level).toBe("info");
  });

  it("降幅超过安全上限时按体重 1% 的红线提示", () => {
    const measurements = [
      measure("2026-10-08", 84.0),
      measure("2026-10-10", 84.0),
      measure("2026-10-12", 84.0),
      measure("2026-10-15", 82.9),
      measure("2026-10-17", 82.9),
      measure("2026-10-19", 82.9),
    ];
    const result = buildReview({ days, measurements, profile, start: "2026-10-15", end: "2026-10-21" });
    expect(result.metrics.weeklyDelta).toBe(-1.1);
    const verdict = result.verdicts.find((item) => item.title === "周降幅超过安全上限");
    expect(verdict?.level).toBe("warn");
    expect(verdict?.detail).toContain("0.83");
  });

  it("降幅在安全区间内时给出正面反馈", () => {
    const measurements = [
      measure("2026-10-08", 84.0),
      measure("2026-10-10", 84.0),
      measure("2026-10-12", 84.0),
      measure("2026-10-15", 83.4),
      measure("2026-10-17", 83.4),
      measure("2026-10-19", 83.4),
    ];
    const result = buildReview({ days, measurements, profile, start: "2026-10-15", end: "2026-10-21" });
    const verdict = result.verdicts.find((item) => item.title === "周降幅在安全速率内");
    expect(verdict?.level).toBe("ok");
  });

  it("热量日均超上限时提示", () => {
    const high = Array.from({ length: 7 }, (_, index) =>
      day(`2026-10-${String(15 + index).padStart(2, "0")}`, { calories: 2300 }),
    );
    const result = buildReview({ days: high, measurements: [], profile, start: "2026-10-15", end: "2026-10-21" });
    expect(result.verdicts.some((item) => item.title === "日均热量超出目标")).toBe(true);
  });

  it("蛋白低于目标九成时才升级为警告", () => {
    const low = Array.from({ length: 7 }, (_, index) =>
      day(`2026-10-${String(15 + index).padStart(2, "0")}`, { protein: 140 }),
    );
    const mild = Array.from({ length: 7 }, (_, index) =>
      day(`2026-10-${String(15 + index).padStart(2, "0")}`, { protein: 155 }),
    );
    const lowResult = buildReview({ days: low, measurements: [], profile, start: "2026-10-15", end: "2026-10-21" });
    const mildResult = buildReview({ days: mild, measurements: [], profile, start: "2026-10-15", end: "2026-10-21" });
    expect(lowResult.verdicts.find((item) => item.title === "蛋白摄入偏低")?.level).toBe("warn");
    expect(mildResult.verdicts.find((item) => item.title === "蛋白接近目标")?.level).toBe("info");
  });

  it("运动为空时说明不用补记", () => {
    const result = buildReview({ days, measurements: [], profile, start: "2026-10-15", end: "2026-10-21" });
    expect(result.verdicts.some((item) => item.title === "区间内没有运动记录")).toBe(true);
  });

  it("日历逐日给出四态与运动次数", () => {
    const withWorkout = days.map((item) =>
      item.date === "2026-10-15" ? { ...item, workoutMinutes: 22, workoutCount: 1 } : item,
    );
    const result = buildReview({ days: withWorkout, measurements: [], profile, start: "2026-10-15", end: "2026-10-21" });
    expect(result.calendar).toHaveLength(7);
    const first = result.calendar[0];
    expect(first.date).toBe("2026-10-15");
    expect(first.status).toBe("hit");
    expect(first.workoutCount).toBe(1);
    expect(result.calendar[3].status).toBe("none");
    expect(result.calendar[5].status).toBe("partial");
  });
});
