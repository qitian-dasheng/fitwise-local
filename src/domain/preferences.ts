/**
 * 界面偏好只存浏览器 localStorage：不进 AppState，不写领域库，不参与导出与审计。
 * 读写失败一律静默回落，不能因为一个显示开关弹出保存失败提示。
 */
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
