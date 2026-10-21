import { invoke } from "@tauri-apps/api/core";
import { Download } from "lucide-react";
import { useRef, useState } from "react";
import { exportDomainJson } from "../data/domainQueries";
import { assertDesktopBridge, isTauriRuntime } from "../data/storage";
import { useAppStore } from "../store/appStore";
import type { AppState } from "../domain/types";

const collections = ["foodDefinitions", "foodDefinitionVersions", "meals", "checkIns", "measurements", "workouts", "recipes", "batches", "consumptionEvents", "wasteEvents", "auditEvents", "inventory", "inventoryMovements", "purchases", "inbox", "plans"] as const;

export function captureWindowSnapshot(state: AppState) {
  return {
    app: "Fitwise Local", schemaVersion: 12, persistVersion: 4,
    source: "window_snapshot_unverified", exportedAt: new Date().toISOString(),
    warning: "当前窗口快照，不代表数据库已保存；不含附件原件和独立标签草稿。恢复前须核对差异并另行确认。",
    profile: state.profile,
    aiSettings: Object.fromEntries((["provider", "baseUrl", "model", "monthlyLimitCny", "estimatedSpendCny", "usageMonth", "cloudEnabled"] as const).map(key => [key, state.aiSettings[key]])),
    ...Object.fromEntries(collections.map(key => [key, state[key]])),
  };
}

export function DataExportPanel() {
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [recoveryText, setRecoveryText] = useState("");
  async function exportJson(snapshot: boolean) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setMessage("");
    // Capture in-memory records before awaiting I/O; never merge them into SQLite.
    const windowSnapshot = captureWindowSnapshot(useAppStore.getState());
    let capturedRaw = "";
    try {
      const exported = snapshot || !isTauriRuntime() ? windowSnapshot : await exportDomainJson();
      const raw = JSON.stringify(exported, null, 2);
      capturedRaw = raw;
      setRecoveryText(raw);
      const name = `fitwise-${exported.source === "sqlite_domain_repository" ? "database" : "window"}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
      if (isTauriRuntime()) {
        assertDesktopBridge();
        const { save } = await import("@tauri-apps/plugin-dialog");
        const path = await save({ defaultPath: name, filters: [{ name: "轻衡 JSON（未加密）", extensions: ["json"] }] });
        if (!path) { setMessage("已取消，未写入文件。快照仍可在下方复制。"); return; }
        const result = await invoke<{ path: string; bytes: number; sha256: string }>("write_json_export", { outputPath: path, raw });
        setMessage(`已写入并回读校验：${result.path}（${result.bytes} 字节，SHA-256 ${result.sha256}）。${snapshot ? "这是当前窗口快照，尚未与数据库对账。" : "请核对导出记录与当前界面是否一致。"}`);
        setRecoveryText("");
      } else {
        const url = URL.createObjectURL(new Blob([raw], { type: "application/json" }));
        const link = document.createElement("a");
        link.href = url; link.download = name; document.body.append(link); link.click(); link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        setMessage("已请求浏览器下载窗口快照；请检查下载结果。这不是桌面数据库导出。");
      }
    } catch (cause) {
      if (!capturedRaw) setRecoveryText(JSON.stringify(windowSnapshot, null, 2));
      setMessage(`导出未完成：${String(cause)}。不要关闭原窗口。${!capturedRaw ? "下方仅为本次操作开始时的窗口快照，不是数据库导出。" : "下方文本尚未成功写入文件，可手动复制。"}`);
    } finally { lock.current = false; setBusy(false); }
  }
  return <div className="form compact-form">
    <p className="form-hint">JSON 含健康、饮食和采购资料，未加密。请保存在私人位置，不要上传到公开仓库。导出不会覆盖已有文件，也不会导入或修改记录。</p>
    <div className="button-row">
      <button className="button secondary" disabled={busy} onClick={() => void exportJson(false)}><Download size={15}/> {busy ? "正在导出…" : "导出数据库 JSON（未加密）"}</button>
      <button className="button secondary" disabled={busy} onClick={() => void exportJson(true)}>另存当前窗口快照</button>
    </div>
    <p className="form-hint">若界面与磁盘不一致，先保全当前窗口快照；快照不证明数据库已保存，也不含附件原件或独立标签草稿。</p>
    {message && <p role="status">{message}</p>}
    {recoveryText && <label>备用复制文本（未加密；点击后 Ctrl+A、Ctrl+C，自行另存）<textarea aria-label="导出备用 JSON" rows={8} value={recoveryText} readOnly onFocus={event => event.currentTarget.select()}/></label>}
  </div>;
}
