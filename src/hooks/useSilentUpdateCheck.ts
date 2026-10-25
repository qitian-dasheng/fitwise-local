import { useEffect } from "react";
import { readUpdateProxyMode, readUpdateSilentCheck } from "../domain/preferences";
import { isTauriRuntime } from "../data/storage";

const LAST_CHECK_KEY = "qingheng.updates.last-check";

export interface LastCheckRecord {
  ok: boolean;
  at: string;
  error?: string;
}

export function readLastCheck(): LastCheckRecord | null {
  try {
    const raw = localStorage.getItem(LAST_CHECK_KEY);
    return raw ? (JSON.parse(raw) as LastCheckRecord) : null;
  } catch {
    return null;
  }
}

function writeLastCheck(record: LastCheckRecord): void {
  localStorage.setItem(LAST_CHECK_KEY, JSON.stringify(record));
}

/**
 * 启动静默检查更新（0.9.3 起，可在设置页关闭）。
 * 行为与其他桌面软件一致：后台查 → 有新版则后台下载并验签 → 弹一次确认 → 同意即重启安装。
 * 0.11.0 起：跟随系统代理（可在设置切直连）；失败写入 last-check 记录——今日页给一次性
 * 非侵入提示，本钩子自身仍不弹任何东西。插件用动态 import：浏览器预览不加载更新代码。
 */
export function useSilentUpdateCheck(): void {
  useEffect(() => {
    if (!isTauriRuntime() || !readUpdateSilentCheck()) return;
    let cancelled = false;
    void (async () => {
      try {
        const [{ check }, { invoke }] = await Promise.all([
          import("@tauri-apps/plugin-updater"),
          import("@tauri-apps/api/core"),
        ]);
        let proxy: string | undefined;
        if (readUpdateProxyMode() === "system") {
          try {
            const system = await invoke<{ url: string | null }>("get_system_proxy");
            proxy = system.url ?? undefined;
          } catch {
            // 读系统代理失败：直连重试（旧行为）。
          }
        }
        const update = await check(proxy ? { proxy } : {});
        if (!update || cancelled) {
          if (!cancelled) writeLastCheck({ ok: true, at: new Date().toISOString() });
          return;
        }
        await update.downloadAndInstall();
        if (cancelled) return;
        writeLastCheck({ ok: true, at: new Date().toISOString() });
        const { ask } = await import("@tauri-apps/plugin-dialog");
        const install = await ask(`新版本 ${update.version} 已下载并校验完成。现在重启轻衡以完成安装？`, { title: "轻衡更新", kind: "info" });
        if (install && !cancelled) {
          const { relaunch } = await import("@tauri-apps/plugin-process");
          await relaunch();
        }
      } catch (cause) {
        if (cancelled) return;
        // 静默不弹窗，但记录失败供今日页一次性提示与设置页展示。
        writeLastCheck({ ok: false, at: new Date().toISOString(), error: String(cause) });
      }
    })();
    return () => { cancelled = true; };
  }, []);
}
