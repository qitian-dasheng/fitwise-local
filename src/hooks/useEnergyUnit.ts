import { useCallback, useEffect, useState } from "react";
import { readEnergyUnit, writeEnergyUnit, type EnergyUnitPref } from "../domain/preferences";

/**
 * 能量单位显示开关的 React 封装：mount 时读一次偏好，切换时写偏好并同步状态。
 * 偏好刻意不进 AppState（见 preferences.ts 头注释）；各页自行调用本 hook，
 * 页面按导航条件渲染会重新挂载，因此切回该页即拿到最新单位，不需要全局广播。
 */
export function useEnergyUnit(): [EnergyUnitPref, (unit: EnergyUnitPref) => void] {
  const [unit, setUnit] = useState<EnergyUnitPref>(() => readEnergyUnit());
  useEffect(() => {
    setUnit(readEnergyUnit());
  }, []);
  const update = useCallback((next: EnergyUnitPref) => {
    writeEnergyUnit(next);
    setUnit(next);
  }, []);
  return [unit, update];
}
