import { beforeEach, describe, expect, it } from "vitest";
import {
  KJ_PER_KCAL,
  energyUnitLabels,
  energyUnitNames,
  formatEnergy,
  toDisplayEnergy,
  toDisplayEnergyMaybe,
} from "../src/domain/energyDisplay";
import { ENERGY_UNIT_KEY, readEnergyUnit, writeEnergyUnit } from "../src/domain/preferences";

beforeEach(() => {
  window.localStorage.clear();
});

describe("toDisplayEnergy", () => {
  it("kcal 模式原样返回", () => {
    expect(toDisplayEnergy(2015, "kcal")).toBe(2015);
  });

  it("kJ 模式按 4.184 换算并取整", () => {
    expect(toDisplayEnergy(2000, "kJ")).toBe(Math.round(2000 * KJ_PER_KCAL));
    expect(toDisplayEnergy(300, "kJ")).toBe(1255); // 300 × 4.184 = 1255.2 → 1255
  });

  it("非有限数原样透传，不产生 NaN 文案", () => {
    expect(toDisplayEnergy(Number.NaN, "kJ")).toBe(Number.NaN);
    expect(toDisplayEnergy(Number.POSITIVE_INFINITY, "kJ")).toBe(Number.POSITIVE_INFINITY);
  });

  it("可空版本对 null / undefined 原样透传", () => {
    expect(toDisplayEnergyMaybe(null, "kJ")).toBeNull();
    expect(toDisplayEnergyMaybe(undefined, "kJ")).toBeUndefined();
    expect(toDisplayEnergyMaybe(100, "kJ")).toBe(418);
  });
});

describe("formatEnergy", () => {
  it("输出「数值 + 单位」，单位跟随开关", () => {
    expect(formatEnergy(300, "kcal")).toBe("300 kcal");
    expect(formatEnergy(300, "kJ")).toBe("1255 kJ");
  });

  it("空值与非有限数显示「未知」，与营养列口径一致", () => {
    expect(formatEnergy(null, "kcal")).toBe("未知");
    expect(formatEnergy(undefined, "kJ")).toBe("未知");
    expect(formatEnergy(Number.NaN, "kJ")).toBe("未知");
  });

  it("单位标签表齐全", () => {
    expect(energyUnitLabels).toEqual({ kcal: "kcal", kJ: "kJ" });
    expect(energyUnitNames).toEqual({ kcal: "千卡", kJ: "千焦" });
  });
});

describe("能量单位偏好（0.9.3 起固定 kcal）", () => {
  it("无论 localStorage 存了什么（含遗留 kJ），读取一律 kcal", () => {
    expect(readEnergyUnit()).toBe("kcal");
    window.localStorage.setItem(ENERGY_UNIT_KEY, "kJ");
    expect(readEnergyUnit()).toBe("kcal");
    window.localStorage.setItem(ENERGY_UNIT_KEY, "J");
    expect(readEnergyUnit()).toBe("kcal");
  });
});
