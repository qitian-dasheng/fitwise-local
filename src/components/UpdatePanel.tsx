import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";
import { getVersion } from "@tauri-apps/api/app";
import { Copy, RotateCcw, SearchCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { readUpdateProxyMode, readUpdateSilentCheck, writeUpdateProxyMode, writeUpdateSilentCheck, type UpdateProxyMode } from "../domain/preferences";
import { isTauriRuntime } from "../data/storage";

/**
 * 设置页「关于与更新」卡：当前版本、手动检查更新（下载→验签→安装→重启），
 * 以及启动静默检查的开关与代理模式。更新检查是本应用唯一的外网行为（README 隐私声明同口径）。
 * 浏览器预览（非 Tauri）显示不可用说明，不伪装成功。
 */
export function UpdatePanel() {
  const desktop = isTauriRuntime();
  const [version, setVersion] = useState("");
  const [phase, setPhase] = useState<"idle" | "checking" | "downloading" | "ready" | "latest" | "error">("idle");
  const [note, setNote] = useState("");
  const [errorDetail, setErrorDetail] = useState("");
  const [silentCheck, setSilentCheck] = useState(readUpdateSilentCheck());
  const [proxyMode, setProxyMode] = useState<UpdateProxyMode>(readUpdateProxyMode());

  useEffect(() => {
    if (!desktop) return;
    void getVersion().then(setVersion, () => setVersion("未知"));
  }, [desktop]);

  /** 代理解析：跟随系统代理时读注册表（0.11.0 修复 v0.10.0 验签失败的根因）。 */
  async function resolveProxy(): Promise<{ proxy?: string; note: string }> {
    if (proxyMode === "direct") return { note: "直连模式" };
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const proxy = await invoke<{ url: string | null }>("get_system_proxy");
      if (proxy.url) return { proxy: proxy.url, note: `经系统代理 ${proxy.url}` };
      return { note: "未检测到系统代理，直连" };
    } catch (cause) {
      return { note: `读取系统代理失败（${String(cause)}），直连` };
    }
  }

  async function checkAndInstall() {
    if (phase === "checking" || phase === "downloading") return;
    setPhase("checking");
    setNote("");
    setErrorDetail("");
    const { proxy, note: proxyNote } = await resolveProxy();
    setNote(`检查中（${proxyNote}）…`);
    try {
      const update = await check({ ...(proxy ? { proxy } : {}) });
      if (!update) {
        setPhase("latest");
        setNote(`当前 ${version} 已是最新版本。`);
        return;
      }
      setPhase("downloading");
      setNote(`发现新版本 ${update.version}，正在下载并校验签名…`);
      let contentLength = 0;
      let downloaded = 0;
      await update.downloadAndInstall((event) => {
        if (event.event === "Started" && event.data.contentLength) contentLength = event.data.contentLength;
        if (event.event === "Progress" && event.data.chunkLength) {
          downloaded += event.data.chunkLength;
          if (contentLength) setNote(`发现新版本 ${update.version}，下载中 ${Math.min(99, Math.round((downloaded / contentLength) * 100))}%…`);
        }
      });
      setPhase("ready");
      setNote(`新版本 ${update.version} 已就绪，重启后生效。`);
    } catch (cause) {
      setPhase("error");
      setErrorDetail(String(cause));
      setNote(`更新未完成。可稍后重试，或到发布页手动下载。`);
    }
  }

  async function copyError() {
    try {
      await navigator.clipboard.writeText(errorDetail);
      setNote("错误详情已复制。");
    } catch {
      setNote("复制失败，请手动选择文本复制。");
    }
  }

  return (
    <div>
      {/* 0.9.4 起挂在设置页弹窗里，卡片壳与标题由 Modal 提供。 */}
      <p className="form-hint">更新包带签名校验；更新检查是本应用唯一的外网网络行为。</p>
      <div className="form">
        <label>当前版本<input readOnly value={desktop ? (version || "读取中…") : "浏览器预览（无桌面更新能力）"} /></label>
        <label>代理模式<select value={proxyMode} disabled={!desktop} onChange={(event) => { const mode = event.target.value as UpdateProxyMode; setProxyMode(mode); writeUpdateProxyMode(mode); }}>
          <option value="system">跟随系统代理（推荐）</option>
          <option value="direct">直连（不走代理）</option>
        </select></label>
        <label className="checkbox-label"><input type="checkbox" checked={silentCheck} disabled={!desktop} onChange={(event) => { setSilentCheck(event.target.checked); writeUpdateSilentCheck(event.target.checked); }} /><span>启动时静默检查更新（发现新版本会下载并在确认后重启安装）</span></label>
        <div className="button-row">
          <button className="button secondary" disabled={!desktop || phase === "checking" || phase === "downloading"} onClick={() => void checkAndInstall()}>
            <SearchCheck size={15}/> {phase === "checking" ? "正在检查…" : phase === "downloading" ? "正在下载…" : "检查更新"}
          </button>
          {phase === "ready" && <button className="button primary" onClick={() => void relaunch().catch(() => setNote("重启失败：请手动退出应用后重新打开。"))}><RotateCcw size={15}/> 立即重启</button>}
          {desktop && <a className="text-button" href="https://github.com/qitian-dasheng/fitwise-local/releases" target="_blank" rel="noreferrer">发布页</a>}
        </div>
        {note && <p className="form-hint" role="status">{note}</p>}
        {phase === "error" && errorDetail && (
          <div className="update-error-detail">
            <code>{errorDetail}</code>
            <button className="text-button" onClick={() => void copyError()}><Copy size={14}/> 复制错误详情</button>
          </div>
        )}
      </div>
    </div>
  );
}
