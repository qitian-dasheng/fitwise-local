import { describe, expect, it } from "vitest";
import {
  dailyRepresentatives,
  formatWeight,
  isActiveMeasurement,
  makeMeasuredAt,
  measurementConditionLabel,
  measurementRows,
  measurementTime,
  measurementTimestamp,
  sameDayIndex,
  validateWeightInput,
  weightDelta,
} from "../src/domain/body";
import type { BodyMeasurement } from "../src/domain/types";

function m(overrides: Partial<BodyMeasurement> & { id: string }): BodyMeasurement {
  return { date: "2026-10-20", weightKg: 83, createdAt: "2026-10-20T00:00:00Z", ...overrides };
}

describe("体重记录的有效性判定", () => {
  it("只把缺失状态或显式 active 当成有效", () => {
    expect(isActiveMeasurement(m({ id: "a" }))).toBe(true);
    expect(isActiveMeasurement(m({ id: "b", status: "active" }))).toBe(true);
    expect(isActiveMeasurement(m({ id: "c", status: "superseded" }))).toBe(false);
    expect(isActiveMeasurement(m({ id: "d", status: "void" }))).toBe(false);
  });
});

describe("称重时刻", () => {
  it("拼接带 +08:00 的 measuredAt", () => {
    expect(makeMeasuredAt("2026-10-21", "06:32")).toBe("2026-10-21T06:32:00+08:00");
    expect(makeMeasuredAt("2026-10-21", "06:32:15")).toBe("2026-10-21T06:32:15+08:00");
  });

  it("旧记录没有 measuredAt 时如实显示未标注，不拿入库时间冒充", () => {
    expect(measurementTime(m({ id: "old" }))).toBe("未标注");
    expect(measurementTime(m({ id: "new", measuredAt: "2026-10-21T06:32:00+08:00" }))).toBe("06:32");
  });

  it("排序时间戳缺失时回退到 createdAt", () => {
    const created = Date.parse("2026-10-20T00:00:00Z");
    expect(measurementTimestamp(m({ id: "old" }))).toBe(created);
    expect(measurementTimestamp(m({ id: "new", measuredAt: "2026-10-21T06:32:00+08:00" }))).toBe(
      Date.parse("2026-10-21T06:32:00+08:00"),
    );
  });

  it("条件三态文案", () => {
    expect(measurementConditionLabel(m({ id: "a", condition: "morning" }))).toBe("晨起");
    expect(measurementConditionLabel(m({ id: "b", condition: "other" }))).toBe("其他");
    expect(measurementConditionLabel(m({ id: "c" }))).toBe("未标注");
  });
});

describe("每日趋势代表值", () => {
  it("同日多条默认取时刻最新的一条", () => {
    const rows = dailyRepresentatives([
      m({ id: "a", date: "2026-10-21", weightKg: 83.2, measuredAt: "2026-10-21T06:30:00+08:00" }),
      m({ id: "b", date: "2026-10-21", weightKg: 83.6, measuredAt: "2026-10-21T21:10:00+08:00" }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("b");
  });

  it("显式指定的代表值优先于时刻", () => {
    const rows = dailyRepresentatives([
      m({ id: "a", date: "2026-10-21", weightKg: 83.2, measuredAt: "2026-10-21T06:30:00+08:00", dayRepresentative: true }),
      m({ id: "b", date: "2026-10-21", weightKg: 83.6, measuredAt: "2026-10-21T21:10:00+08:00" }),
    ]);
    expect(rows.map((item) => item.id)).toEqual(["a"]);
  });

  it("排除已更正与已作废，且按日期升序输出", () => {
    const rows = dailyRepresentatives([
      m({ id: "void", date: "2026-10-19", status: "void" }),
      m({ id: "superseded", date: "2026-10-19", status: "superseded" }),
      m({ id: "late", date: "2026-10-21", weightKg: 83.6 }),
      m({ id: "early", date: "2026-10-19", weightKg: 84 }),
    ]);
    expect(rows.map((item) => item.id)).toEqual(["early", "late"]);
  });

  it("时刻完全相同时用 id 兜底，保证结果稳定", () => {
    const rows = dailyRepresentatives([
      m({ id: "aaa", date: "2026-10-21", measuredAt: "2026-10-21T06:30:00+08:00" }),
      m({ id: "bbb", date: "2026-10-21", measuredAt: "2026-10-21T06:30:00+08:00" }),
    ]);
    expect(rows[0].id).toBe("bbb");
  });
});

describe("变化值与格式化", () => {
  it("首条与下降与上升与持平", () => {
    expect(weightDelta(83)).toBe("—");
    expect(weightDelta(82.6, 83)).toBe("-0.40");
    expect(weightDelta(83.3, 83)).toBe("+0.30");
    expect(weightDelta(83, 83)).toBe("持平");
    expect(weightDelta(83.001, 83)).toBe("持平");
  });

  it("体重固定两位小数", () => {
    expect(formatWeight(82.6)).toBe("82.60");
    expect(formatWeight(82.456)).toBe("82.46");
  });
});

describe("体重输入校验", () => {
  it("接受一位与两位小数", () => {
    expect(validateWeightInput("82.6")).toEqual({ value: 82.6 });
    expect(validateWeightInput("82.65")).toEqual({ value: 82.65 });
  });

  it("拒绝空值、非数字、超范围与三位小数", () => {
    expect(validateWeightInput("  ").error).toContain("请填写");
    expect(validateWeightInput("82.6kg").error).toContain("数字");
    expect(validateWeightInput("19.99").error).toContain("20");
    expect(validateWeightInput("400.01").error).toContain("400");
    expect(validateWeightInput("82.555").error).toContain("两位小数");
  });
});

describe("同一天的第几次称重", () => {
  it("按时刻排序给出序号，作废记录不占序号", () => {
    const list = [
      m({ id: "a", date: "2026-10-21", measuredAt: "2026-10-21T06:30:00+08:00" }),
      m({ id: "b", date: "2026-10-21", measuredAt: "2026-10-21T12:30:00+08:00" }),
      m({ id: "c", date: "2026-10-21", measuredAt: "2026-10-21T21:30:00+08:00" }),
      m({ id: "void", date: "2026-10-21", measuredAt: "2026-10-21T08:00:00+08:00", status: "void" }),
    ];
    expect(sameDayIndex(list, list[0])).toBe(1);
    expect(sameDayIndex(list, list[2])).toBe(3);
    expect(sameDayIndex(list, list[3])).toBeNull();
  });
});

describe("历史表逐行数据", () => {
  it("倒序排列，变化值只在有效行之间计算，作废行保留", () => {
    const rows = measurementRows([
      m({ id: "d1", date: "2026-10-19", weightKg: 84, measuredAt: "2026-10-19T06:20:00+08:00" }),
      m({ id: "d2", date: "2026-10-20", weightKg: 83.6, measuredAt: "2026-10-20T06:25:00+08:00" }),
      m({ id: "d3", date: "2026-10-21", weightKg: 83.2, measuredAt: "2026-10-21T06:30:00+08:00" }),
      m({ id: "v1", date: "2026-10-21", weightKg: 90, measuredAt: "2026-10-21T09:00:00+08:00", status: "void" }),
    ]);
    expect(rows.map((row) => row.measurement.id)).toEqual(["v1", "d3", "d2", "d1"]);
    expect(rows.find((row) => row.measurement.id === "d3")!.delta).toBe("-0.40");
    expect(rows.find((row) => row.measurement.id === "d1")!.delta).toBe("—");
    expect(rows.find((row) => row.measurement.id === "v1")!.delta).toBe("—");
    expect(rows.find((row) => row.measurement.id === "v1")!.dayIndex).toBeNull();
  });

  it("标出当日代表与当日第 N 次", () => {
    const rows = measurementRows([
      m({ id: "a", date: "2026-10-21", weightKg: 83.4, measuredAt: "2026-10-21T06:30:00+08:00" }),
      m({ id: "b", date: "2026-10-21", weightKg: 83.1, measuredAt: "2026-10-21T21:30:00+08:00" }),
    ]);
    const second = rows.find((row) => row.measurement.id === "b")!;
    const first = rows.find((row) => row.measurement.id === "a")!;
    expect(second.isRepresentative).toBe(true);
    expect(first.isRepresentative).toBe(false);
    expect(second.dayIndex).toBe(2);
    expect(first.dayIndex).toBe(1);
  });

  it("变化值带对比提示", () => {
    const rows = measurementRows([
      m({ id: "a", date: "2026-10-20", weightKg: 83.9, measuredAt: "2026-10-20T06:41:00+08:00" }),
      m({ id: "b", date: "2026-10-21", weightKg: 83.5, measuredAt: "2026-10-21T06:30:00+08:00" }),
    ]);
    expect(rows[0].deltaTitle).toContain("10-20 06:41");
    expect(rows[0].deltaTitle).toContain("83.90");
  });
});
