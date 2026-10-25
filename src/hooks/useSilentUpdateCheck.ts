import { useEffect } from "react";
import { readUpdateSilentCheck } from "../domain/preferences";
import { isTauriRuntime } from "../data/storage";

/**
 * 启动静默检查更新（0.9.3 起，可在设置页关闭）。
 * 行为与其他桌面软件一致：后台查 → 有新版则后台下载并验签 → 弹一次确认 → 同意即重启安装。
 * 任何失败（离线、GitHub 不可达、签名问题）一律静默吞掉——更新是服务，不是打扰；
 * 用户随时可在设置页手动检查。插件用动态 import：浏览器预览不加载更新代码。
 */
export function useSilentUpdateCheck(): void {
  useEffect(() => {
    if (!isTauriRuntime() || !readUpdateSilentCheck()) return;
    let cancelled = false;
    void (async () => {
      try {
        const { check } = await import("@tauri-apps/plugin-updater");
        const update = await check();
        if (!update || cancelled) return;
        await update.downloadAndInstall();
        if (cancelled) return;
        const { ask } = await import("@tauri-apps/plugin-dialog");
        const install = await ask(`新版本 ${update.version} 已下载并校验完成。现在重启轻衡以完成安装？`, { title: "轻衡更新", kind: "info" });
        if (install && !cancelled) {
          const { relaunch } = await import("@tauri-apps/plugin-process");
          await relaunch();
        }
      } catch {
        // 静默：启动检查失败不打扰用户，设置页里可手动重试。
      }
    })();
    return () => { cancelled = true; };
  }, []);
}
