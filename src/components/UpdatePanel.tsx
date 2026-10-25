import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";
import { getVersion } from "@tauri-apps/api/app";
import { RotateCcw, SearchCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { readUpdateSilentCheck, writeUpdateSilentCheck } from "../domain/preferences";
import { isTauriRuntime } from "../data/storage";

/**
 * 设置页「关于与更新」卡：当前版本、手动检查更新（下载→验签→安装→重启），
 * 以及启动静默检查的开关。更新检查是本应用唯一的网络行为（README 隐私声明同口径）。
 * 浏览器预览（非 Tauri）显示不可用说明，不伪装成功。
 */
export function UpdatePanel() {
  const desktop = isTauriRuntime();
  const [version, setVersion] = useState("");
  const [phase, setPhase] = useState<"idle" | "checking" | "downloading" | "ready" | "latest" | "error">("idle");
  const [note, setNote] = useState("");
  const [silentCheck, setSilentCheck] = useState(readUpdateSilentCheck());

  useEffect(() => {
    if (!desktop) return;
    void getVersion().then(setVersion, () => setVersion("未知"));
  }, [desktop]);

  async function checkAndInstall() {
    if (phase === "checking" || phase === "downloading") return;
    setPhase("checking");
    setNote("");
    try {
      const update = await check();
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
      setNote(`更新未完成：${String(cause)}。可稍后在「检查更新」重试，或到发布页手动下载。`);
    }
  }

  return (
    <div>
      {/* 0.9.4 起挂在设置页弹窗里，卡片壳与标题由 Modal 提供。 */}
      <p className="form-hint">更新包带签名校验；更新检查是本应用唯一的网络行为。</p>
      <div className="form">
        <label>当前版本<input readOnly value={desktop ? (version || "读取中…") : "浏览器预览（无桌面更新能力）"} /></label>
        <label className="checkbox-label"><input type="checkbox" checked={silentCheck} disabled={!desktop} onChange={(event) => { setSilentCheck(event.target.checked); writeUpdateSilentCheck(event.target.checked); }} /><span>启动时静默检查更新（发现新版本会下载并在确认后重启安装）</span></label>
        <div className="button-row">
          <button className="button secondary" disabled={!desktop || phase === "checking" || phase === "downloading"} onClick={() => void checkAndInstall()}>
            <SearchCheck size={15}/> {phase === "checking" ? "正在检查…" : phase === "downloading" ? "正在下载…" : "检查更新"}
          </button>
          {phase === "ready" && <button className="button primary" onClick={() => void relaunch().catch(() => setNote("重启失败：请手动退出应用后重新打开。"))}><RotateCcw size={15}/> 立即重启</button>}
          {desktop && <a className="text-button" href="https://github.com/qitian-dasheng/fitwise-local/releases" target="_blank" rel="noreferrer">发布页</a>}
        </div>
        {note && <p className="form-hint" role="status">{note}</p>}
      </div>
    </div>
  );
}
