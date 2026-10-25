import { useCallback, useEffect, useState } from "react";
import { readTheme, writeTheme, type ThemePref } from "../domain/preferences";

/**
 * 主题封装：挂载时读偏好并挂到 <html data-theme>（--ui-* 令牌层的开关），
 * 切换时写偏好并同步属性。迁移期间旧令牌组件不响应主题，属预期过渡态。
 */
export function useTheme(): [ThemePref, (theme: ThemePref) => void] {
  const [theme, setTheme] = useState<ThemePref>(() => readTheme());
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  const update = useCallback((next: ThemePref) => {
    writeTheme(next);
    setTheme(next);
  }, []);
  return [theme, update];
}
