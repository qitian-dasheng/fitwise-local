/**
 * 0.4.10 进度证据领域测试：腰围/体脂的序列、区间变化、校验与复盘提示。
 * 只用内存夹具，不碰真实数据。
 */

import { describe, expect, it } from "vitest";
import {
  BODY_FAT_MAX_PERCENT,
  BODY_FAT_MIN_PERCENT,
  WAIST_MAX_CM,
  WAIST_MIN_CM,
  circumferenceMetric,
  circumferenceSeries,
  formatCm,
  formatPercent,
  girthDeltaText,
  latestCircumference,
  validateBodyFatInput,
  validateWaistInput,
} from "../src/domain/body";
import { daySpan } from "../src/domain/diary";
import { buildReview, type ReviewDay } from "../src/domain/review";
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

function measure(date: string, weightKg: number, extra: Partial<BodyMeasurement> = {}): BodyMeasurement {
  return {
    id: `${date}-${weightKg}-${extra.waistCm ?? ""}`,
    date,
    weightKg,
    createdAt: `${date}T06:00:00+08:00`,
    ...extra,
  };
}

function day(
  date: string,
  overrides: Partial<{ calories: number; protein: number; mealCount: number; complete: boolean }> = {},
): ReviewDay {
  const { calories = 2000, protein = 165, mealCount = 3, complete = true } = overrides;
  return {
    date,
    complete,
    mealCount,
    workoutMinutes: 0,
    workoutCount: 0,
    totals: { calories, protein, carbohydrates: 200, fat: 60, fiber: 28, sugar: 20, sodium: 2000 },
    coverage: {
      calories: 100,
      protein: 100,
      carbohydrates: 100,
      fat: 100,
      fiber: 100,
      sugar: 100,
      sodium: 100,
    },
  };
}

describe("daySpan 区间天数", () => {
  it("含头含尾，同一天算 1 天", () => {
    expect(daySpan("2026-10-21", "2026-10-21")).toBe(1);
    expect(daySpan("2026-10-19", "2026-10-31")).toBe(13);
    expect(daySpan("2026-09-30", "2026-10-02")).toBe(3);
  });

  it("反向或非法日期返回 0，让调用方自己守住边界", () => {
    expect(daySpan("2026-10-21", "2026-10-19")).toBe(0);
    expect(daySpan("", "2026-10-21")).toBe(0);
  });
});

describe("腰围与体脂校验", () => {
  it("留空表示没量，返回空对象而不是报错或 0", () => {
    expect(validateWaistInput("")).toEqual({});
    expect(validateWaistInput("   ")).toEqual({});
    expect(validateBodyFatInput("")).toEqual({});
  });

  it("超出区间按中文字面提示", () => {
    expect(validateWaistInput(String(WAIST_MIN_CM - 1)).error).toBe("腰围需在 40–200 cm 之间。");
    expect(validateWaistInput(String(WAIST_MAX_CM + 1)).error).toBe("腰围需在 40–200 cm 之间。");
    expect(validateBodyFatInput(String(BODY_FAT_MIN_PERCENT - 1)).error).toBe("体脂率需在 3%–70% 之间。");
    expect(validateBodyFatInput(String(BODY_FAT_MAX_PERCENT + 1)).error).toBe("体脂率需在 3%–70% 之间。");
  });

  it("只接受一位小数", () => {
    expect(validateWaistInput("92.55").error).toBe("腰围最多保留一位小数。");
    expect(validateWaistInput("92.5")).toEqual({ value: 92.5 });
    expect(validateBodyFatInput("24.35").error).toBe("体脂率最多保留一位小数。");
    expect(validateBodyFatInput("24.3")).toEqual({ value: 24.3 });
  });

  it("非数字直接拒绝", () => {
    expect(validateWaistInput("92.5cm").error).toBe("腰围只能是数字。");
    expect(validateBodyFatInput("-1").error).toBe("体脂率只能是数字。");
  });
});

describe("围度序列与区间变化", () => {
  it("只取有该字段的记录，同一天取最晚的一次", () => {
    const list = [
      measure("2026-10-18", 83.9, { waistCm: 93.5 }),
      measure("2026-10-19", 83.4, { waistCm: 93.0, createdAt: "2026-10-19T06:00:00+08:00" }),
      measure("2026-10-19", 83.3, { waistCm: 92.6, createdAt: "2026-10-19T06:10:00+08:00" }),
      measure("2026-10-20", 83.0),
    ];
    expect(circumferenceSeries(list, "waistCm")).toEqual([
      { date: "2026-10-18", value: 93.5 },
      { date: "2026-10-19", value: 92.6 },
    ]);
  });

  it("作废与已更正的记录不参与", () => {
    const list = [
      measure("2026-10-18", 83.9, { waistCm: 93.5 }),
      measure("2026-10-19", 83.4, { waistCm: 80.0, status: "void" }),
      measure("2026-10-20", 83.0, { waistCm: 79.0, status: "superseded" }),
    ];
    expect(circumferenceSeries(list, "waistCm")).toEqual([{ date: "2026-10-18", value: 93.5 }]);
  });

  it("区间内一次都没量过时返回 null，不拿区间外的数据充数", () => {
    const series = [{ date: "2026-09-01", value: 95 }];
    expect(circumferenceMetric(series, "2026-10-19", "2026-10-31")).toBeNull();
  });

  it("基线取区间开始前最近一次", () => {
    const series = [
      { date: "2026-10-10", value: 94.0 },
      { date: "2026-10-20", value: 92.0 },
      { date: "2026-10-28", value: 91.2 },
    ];
    expect(circumferenceMetric(series, "2026-10-19", "2026-10-31")).toEqual({
      latest: 91.2,
      latestDate: "2026-10-28",
      change: -2.8,
      baseDate: "2026-10-10",
    });
  });

  it("没有区间前基线时退回区间内第一条；只有一个点时 change 为 null", () => {
    const series = [
      { date: "2026-10-20", value: 92.0 },
      { date: "2026-10-25", value: 91.0 },
    ];
    expect(circumferenceMetric(series, "2026-10-19", "2026-10-31")?.change).toBe(-1);
    expect(circumferenceMetric(series.slice(0, 1), "2026-10-19", "2026-10-31")).toEqual({
      latest: 92.0,
      latestDate: "2026-10-20",
      change: null,
      baseDate: null,
    });
  });

  it("latestCircumference 只看到所选日为止，并与上一次比较", () => {
    const list = [
      measure("2026-10-18", 83.9, { waistCm: 93.5 }),
      measure("2026-10-25", 82.0, { waistCm: 91.5 }),
    ];
    expect(latestCircumference(list, "waistCm", "2026-10-20")).toEqual({
      latest: 93.5,
      latestDate: "2026-10-18",
      change: null,
      baseDate: null,
    });
    expect(latestCircumference(list, "waistCm", "2026-10-31")).toEqual({
      latest: 91.5,
      latestDate: "2026-10-25",
      change: -2,
      baseDate: "2026-10-18",
    });
    expect(latestCircumference(list, "bodyFatPercent", "2026-10-31")).toBeNull();
  });
});

describe("围度文案", () => {
  it("一位小数带单位，持平不带符号", () => {
    expect(formatCm(92.56)).toBe("92.6 cm");
    expect(formatPercent(24.34)).toBe("24.3%");
    expect(girthDeltaText(-1.2, " cm")).toBe("-1.2 cm");
    expect(girthDeltaText(0.4, " cm")).toBe("+0.4 cm");
    expect(girthDeltaText(0, " cm")).toBe("持平");
  });
});

describe("复盘把围度并列进指标", () => {
  const days = [day("2026-10-20"), day("2026-10-21")];

  it("区间腰围与体脂各自算变化", () => {
    const measurements = [
      measure("2026-10-18", 83.9, { waistCm: 93.5, bodyFatPercent: 25.0 }),
      measure("2026-10-21", 82.9, { waistCm: 92.0, bodyFatPercent: 24.2 }),
    ];
    const { metrics } = buildReview({
      days,
      measurements,
      profile,
      start: "2026-10-20",
      end: "2026-10-21",
    });
    expect(metrics.waist).toEqual({
      latest: 92.0,
      latestDate: "2026-10-21",
      change: -1.5,
      baseDate: "2026-10-18",
    });
    expect(metrics.bodyFat?.change).toBe(-0.8);
  });

  it("没有围度记录时两个字段都是 null，不伪造 0", () => {
    const { metrics } = buildReview({
      days,
      measurements: [measure("2026-10-21", 82.9)],
      profile,
      start: "2026-10-20",
      end: "2026-10-21",
    });
    expect(metrics.waist).toBeNull();
    expect(metrics.bodyFat).toBeNull();
  });

  it("腰围下降给 ok，只有一次给 info，上升给 info 并提醒量法", () => {
    const drop = buildReview({
      days,
      measurements: [
        measure("2026-10-18", 83.9, { waistCm: 93.5 }),
        measure("2026-10-21", 82.9, { waistCm: 92.0 }),
      ],
      profile,
      start: "2026-10-20",
      end: "2026-10-21",
    });
    const dropVerdict = drop.verdicts.find((item) => item.title === "腰围在下降");
    expect(dropVerdict?.level).toBe("ok");
    expect(dropVerdict?.detail).toContain("1.5 cm");

    const single = buildReview({
      days,
      measurements: [measure("2026-10-21", 82.9, { waistCm: 92.0 })],
      profile,
      start: "2026-10-20",
      end: "2026-10-21",
    });
    expect(single.verdicts.some((item) => item.title === "腰围只有一次记录")).toBe(true);

    const up = buildReview({
      days,
      measurements: [
        measure("2026-10-18", 83.9, { waistCm: 92.0 }),
        measure("2026-10-21", 82.9, { waistCm: 93.0 }),
      ],
      profile,
      start: "2026-10-20",
      end: "2026-10-21",
    });
    const upVerdict = up.verdicts.find((item) => item.title === "腰围没有下降");
    expect(upVerdict?.level).toBe("info");
    expect(upVerdict?.detail).toContain("量法");
  });
});

describe("复盘提示带具体日期与数字", () => {
  it("热量超上限时点出超在哪几天", () => {
    const { verdicts } = buildReview({
      days: [day("2026-10-19", { calories: 2600 }), day("2026-10-20", { calories: 2700 }), day("2026-10-21", { calories: 1900 })],
      measurements: [],
      profile,
      start: "2026-10-19",
      end: "2026-10-21",
    });
    const verdict = verdicts.find((item) => item.title === "日均热量超出目标");
    expect(verdict?.detail).toContain("10-19、10-20");
  });

  it("热量在区间但个别日子出界时也点名", () => {
    const { verdicts } = buildReview({
      days: [day("2026-10-19", { calories: 2300 }), day("2026-10-20", { calories: 1700 })],
      measurements: [],
      profile,
      start: "2026-10-19",
      end: "2026-10-20",
    });
    const verdict = verdicts.find((item) => item.title === "日均热量在目标区间");
    expect(verdict?.detail).toContain("2 天在区间外");
    expect(verdict?.detail).toContain("10-19、10-20");
  });

  it("蛋白没达标的日子列出来，超过三天时用「等 N 天」收口", () => {
    const { verdicts } = buildReview({
      days: [
        day("2026-10-18", { protein: 100 }),
        day("2026-10-19", { protein: 110 }),
        day("2026-10-20", { protein: 120 }),
        day("2026-10-21", { protein: 130 }),
      ],
      measurements: [],
      profile,
      start: "2026-10-18",
      end: "2026-10-21",
    });
    const verdict = verdicts.find((item) => item.title === "蛋白摄入偏低");
    expect(verdict?.detail).toContain("等 4 天");
  });
});
