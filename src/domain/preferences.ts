/**
 * 界面偏好只存浏览器 localStorage：不进 AppState，不写领域库，不参与导出与审计。
 * 读写失败一律静默回落，不能因为一个显示开关弹出保存失败提示。
 */
import { RANGE_PRESETS, type RangePreset } from "./review";

export const DIARY_SODIUM_KEY = "qingheng.food-diary.show-sodium";

export function readDiaryShowSodium(): boolean {
  try {
    return window.localStorage.getItem(DIARY_SODIUM_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeDiaryShowSodium(visible: boolean): void {
  try {
    window.localStorage.setItem(DIARY_SODIUM_KEY, visible ? "1" : "0");
  } catch {
    // 隐私模式或配额受限时忽略：开关本次会话仍然生效。
  }
}

/**
 * 复盘区间偏好：预设档位与自定义起止日只存一个 key。
 * 拆成两个 key 会出现「选了 14 天、自定义区间还留着」的撕裂状态，读的时候还得再造优先级。
 */
export const TRENDS_RANGE_KEY = "qingheng.trends.range";

export type TrendsRangePref =
  | { mode: "preset"; days: RangePreset }
  | { mode: "custom"; start: string; end: string };

const DEFAULT_TRENDS_RANGE: TrendsRangePref = { mode: "preset", days: 7 };
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function readTrendsRange(): TrendsRangePref {
  try {
    const raw = window.localStorage.getItem(TRENDS_RANGE_KEY);
    if (!raw) return DEFAULT_TRENDS_RANGE;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return DEFAULT_TRENDS_RANGE;
    const value = parsed as Record<string, unknown>;
    if (value.mode === "preset") {
      const days = value.days;
      // 只认界面上真实存在的档位：手改过的 999 天会让查询跨度失控。
      if (typeof days === "number" && RANGE_PRESETS.includes(days as RangePreset)) {
        return { mode: "preset", days: days as RangePreset };
      }
      return DEFAULT_TRENDS_RANGE;
    }
    if (value.mode === "custom") {
      if (typeof value.start !== "string" || typeof value.end !== "string") {
        return DEFAULT_TRENDS_RANGE;
      }
      if (!ISO_DATE.test(value.start) || !ISO_DATE.test(value.end)) return DEFAULT_TRENDS_RANGE;
      return { mode: "custom", start: value.start, end: value.end };
    }
    return DEFAULT_TRENDS_RANGE;
  } catch {
    // 存坏了（手改、旧版本、隐私模式）一律回落默认值，不弹错误。
    return DEFAULT_TRENDS_RANGE;
  }
}

export function writeTrendsRange(value: TrendsRangePref): void {
  try {
    window.localStorage.setItem(TRENDS_RANGE_KEY, JSON.stringify(value));
  } catch {
    // 写不进去也要让本次会话的区间照常生效。
  }
}

/**
 * 能量单位显示偏好：只影响界面显示层的换算（kcal ↔ kJ），数据库存储口径永远是 kcal。
 * 换算系数与 Rust 侧 label_checks::KCAL_PER_KJ 同源，避免出现两套口径。
 */
export const ENERGY_UNIT_KEY = "qingheng.display.energy-unit";

export type EnergyUnitPref = "kcal" | "kJ";

const ENERGY_UNIT_PREFS: readonly EnergyUnitPref[] = ["kcal", "kJ"];

export function readEnergyUnit(): EnergyUnitPref {
  // 0.9.3 板块盘点（用户决策）：显示单位固定 kcal——kJ 录入路径自动换算入库，
  // 显示偏好卡整卡删除；遗留 localStorage 值一律忽略，防止老用户永远卡在 kJ。
  return "kcal";
}

export function writeEnergyUnit(unit: EnergyUnitPref): void {
  try {
    window.localStorage.setItem(ENERGY_UNIT_KEY, unit);
  } catch {
    // 写不进去也要让本次会话的单位照常生效。
  }
}

/**
 * 启动时静默检查更新（0.9.3 起）。默认开：更新检查是本应用唯一的网络行为（README 隐私声明同口径），
 * 用户可在设置页关闭。存 localStorage，与能量单位同一纪律：不进 AppState、不写领域库。
 */
export const UPDATE_SILENT_CHECK_KEY = "qingheng.updates.silent-check";

export function readUpdateSilentCheck(): boolean {
  try {
    // 显式写 0 才算关；从未设置 = 默认开。
    return window.localStorage.getItem(UPDATE_SILENT_CHECK_KEY) !== "0";
  } catch {
    return true;
  }
}

export function writeUpdateSilentCheck(enabled: boolean): void {
  try {
    window.localStorage.setItem(UPDATE_SILENT_CHECK_KEY, enabled ? "1" : "0");
  } catch {
    // 写失败时本次会话的开关状态照常生效。
  }
}

/**
 * 界面主题（0.9.3 起，方向 D 双令牌层）。light 为默认；dark 依赖 [data-theme="dark"]。
 * 与其他界面偏好同一纪律：只存 localStorage，不进 AppState、不写领域库、不参与导出。
 */
export const THEME_KEY = "qingheng.display.theme";

export type ThemePref = "light" | "dark";

export function readTheme(): ThemePref {
  try {
    const raw = window.localStorage.getItem(THEME_KEY);
    return raw === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

export function writeTheme(theme: ThemePref): void {
  try {
    window.localStorage.setItem(THEME_KEY, theme);
  } catch {
    // 写失败时本次会话的主题照常生效。
  }
}
