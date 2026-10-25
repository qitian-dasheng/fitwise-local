import { useCallback, useEffect, useState } from "react";
import { readTheme, writeTheme, type ThemePref } from "../domain/preferences";

/**
 * 主题封装：挂载时读偏好并挂到 <html data-theme>（--ui-* 令牌层的开关），
 * 切换时写偏好并同步属性；0.9.4 起窗口标题栏一并跟随（避免深色内容配浅色系统栏）。
 * 在浏览器（无 Tauri）里 setTheme 调用静默跳过。
 */
export function useTheme(): [ThemePref, (theme: ThemePref) => void] {
  const [theme, setTheme] = useState<ThemePref>(() => readTheme());
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    void (async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        await getCurrentWindow().setTheme(theme === "dark" ? "dark" : "light");
      } catch {
        /* 浏览器预览或权限缺失：内容主题不受影响 */
      }
    })();
  }, [theme]);
  const update = useCallback((next: ThemePref) => {
    writeTheme(next);
    setTheme(next);
  }, []);
  return [theme, update];
}
