import { invoke } from "@tauri-apps/api/core";
import { Database, Download, HardDrive, KeyRound, LockKeyhole, RotateCcw, Shield, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { aiBudgetState, aiProviders, providerDescriptor, validateProviderSettings } from "../ai/providers";
import { Modal } from "../components/Modal";
import { PageHeader } from "../components/PageHeader";
import type { AiProviderId } from "../domain/types";
import { useAppStore } from "../store/appStore";

interface BackupResult {
  path: string;
  createdAt: string;
  encryptedBytes?: number;
  databaseBytes: number;
  integrity: string;
  stagedRestorePath?: string | null;
}

interface RestoreStartupReport {
  status: "applied" | "rolled_back" | "failed";
  message: string;
  appliedAt: string;
  safetyCopyPath?: string | null;
}

const isTauri = () => "__TAURI_INTERNALS__" in window;
const formatBytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(2)} MB`;

export function SettingsPage() {
  const profile = useAppStore((state) => state.profile);
  const aiSettings = useAppStore((state) => state.aiSettings);
  const auditEventCount = useAppStore((state) => state.auditEvents.length);
  const setAiSettings = useAppStore((state) => state.setAiSettings);
  const resetDemo = useAppStore((state) => state.resetDemo);
  const [backupMode, setBackupMode] = useState<"create" | "verify" | null>(null);
  const [passphrase, setPassphrase] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [stageRestore, setStageRestore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [backupResult, setBackupResult] = useState<BackupResult | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [credentialConfigured, setCredentialConfigured] = useState(false);
  const [credentialBusy, setCredentialBusy] = useState(false);
  const [restoreScheduled, setRestoreScheduled] = useState(false);
  const budget = aiBudgetState(aiSettings);
  const providerErrors = validateProviderSettings(aiSettings);

  useEffect(() => {
    setCredentialConfigured(false);
    if (!isTauri()) return;
    void invoke<{ configured: boolean }>("get_ai_credential_status", { provider: aiSettings.provider })
      .then((status) => setCredentialConfigured(status.configured))
      .catch(() => setCredentialConfigured(false));
  }, [aiSettings.provider]);

  useEffect(() => {
    if (!isTauri()) return;
    void invoke<RestoreStartupReport | null>("get_restore_startup_report")
      .then((report) => {
        if (!report) return;
        const suffix = report.safetyCopyPath ? `；原数据库安全副本：${report.safetyCopyPath}` : "";
        setMessage(`${report.message}${suffix}`);
      })
      .catch(() => undefined);
  }, []);

  function exportJson() {
    const state = useAppStore.getState();
    const data = {
      schemaVersion: 2,
      exportedAt: new Date().toISOString(),
      app: "Fitwise Local",
      profile: state.profile,
      meals: state.meals,
      checkIns: state.checkIns,
      measurements: state.measurements,
      workouts: state.workouts,
      recipes: state.recipes,
      batches: state.batches,
      consumptionEvents: state.consumptionEvents,
      wasteEvents: state.wasteEvents,
      auditEvents: state.auditEvents,
      inventory: state.inventory,
      inventoryMovements: state.inventoryMovements,
      purchases: state.purchases,
      inbox: state.inbox,
      plans: state.plans,
      aiSettings: state.aiSettings,
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `fitwise-export-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function openBackup(mode: "create" | "verify") {
    setPassphrase("");
    setConfirmation("");
    setStageRestore(false);
    setMessage("");
    setBackupResult(null);
    setRestoreScheduled(false);
    setBackupMode(mode);
  }

  async function submitBackup() {
    if (!isTauri()) {
      setMessage("加密备份需要在 Tauri 桌面版中使用。");
      return;
    }
    if (passphrase.length < 10) {
      setMessage("备份口令至少需要 10 个字符。");
      return;
    }
    if (backupMode === "create" && passphrase !== confirmation) {
      setMessage("两次输入的备份口令不一致。");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const dialog = await import("@tauri-apps/plugin-dialog");
      if (backupMode === "create") {
        const outputPath = await dialog.save({
          defaultPath: `轻衡-${new Date().toISOString().slice(0, 10)}.fitwise-backup`,
          filters: [{ name: "轻衡加密备份", extensions: ["fitwise-backup"] }],
        });
        if (!outputPath) return;
        const report = await invoke<BackupResult>("create_encrypted_backup", { outputPath, passphrase });
        setBackupResult(report);
        setMessage("备份已创建，并已完成一次解密与 SQLite 完整性恢复验证。");
      } else {
        const path = await dialog.open({
          multiple: false,
          directory: false,
          filters: [{ name: "轻衡加密备份", extensions: ["fitwise-backup"] }],
        });
        if (!path || typeof path !== "string") return;
        const report = await invoke<BackupResult>("inspect_encrypted_backup", { path, passphrase, stageRestore });
        setBackupResult(report);
        setMessage(stageRestore ? "备份验证成功，恢复副本已暂存；当前数据库没有被覆盖。" : "备份验证成功；临时恢复副本已清理。");
      }
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function discardStagedRestore() {
    if (!backupResult?.stagedRestorePath) return;
    setBusy(true);
    try {
      await invoke("discard_staged_restore", { path: backupResult.stagedRestorePath });
      setBackupResult({ ...backupResult, stagedRestorePath: null });
      setMessage("恢复暂存副本已清理；当前数据库未被修改。");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function scheduleRestore() {
    if (!backupResult?.stagedRestorePath || !confirm("确认在下次启动轻衡时恢复这个数据库副本？当前数据库会先保留安全副本，恢复失败会自动回滚。")) return;
    setBusy(true);
    try {
      await invoke("schedule_staged_restore", { path: backupResult.stagedRestorePath });
      setRestoreScheduled(true);
      setMessage("恢复已安排。请正常关闭并重新启动轻衡；启动前会再次校验、保留当前数据库安全副本，并在失败时自动回滚。");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  function changeProvider(provider: AiProviderId) {
    const descriptor = providerDescriptor(provider);
    setAiSettings({ provider, baseUrl: descriptor.defaultBaseUrl, cloudEnabled: false });
    setApiKey("");
  }

  async function saveCredential() {
    if (!isTauri()) {
      setMessage("Windows 凭据存储仅在桌面版中可用。");
      return;
    }
    if (providerErrors.length) {
      setMessage(providerErrors.join("；"));
      return;
    }
    setCredentialBusy(true);
    setMessage("");
    try {
      const status = await invoke<{ configured: boolean }>("save_ai_credential", { provider: aiSettings.provider, apiKey });
      setCredentialConfigured(status.configured);
      setApiKey("");
      setAiSettings({ cloudEnabled: true });
      setMessage("API Key 已保存到 Windows 凭据管理器，不会写入数据库或 JSON 导出。");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setCredentialBusy(false);
    }
  }

  async function deleteCredential() {
    if (!isTauri() || !confirm("删除当前提供商的 API Key？")) return;
    setCredentialBusy(true);
    try {
      await invoke("delete_ai_credential", { provider: aiSettings.provider });
      setCredentialConfigured(false);
      setAiSettings({ cloudEnabled: false });
      setMessage("API Key 已从 Windows 凭据管理器删除。");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setCredentialBusy(false);
    }
  }

  return (
    <div className="page">
      <PageHeader eyebrow="本地优先" title="设置与数据" description="密钥、备份和外部助手权限都应可见、可撤销、可审计。" />
      {message && !backupMode && <div className="settings-notice card" role="status">{message}</div>}
      <div className="settings-grid">
        <section className="card settings-section">
          <div className="settings-title"><Database/><div><h2>个人目标</h2><p>修改目标时创建新版本，不回写历史。</p></div></div>
          <div className="settings-list"><div><span>阶段体重</span><b>{profile.startWeightKg} → {profile.targetWeightKg} kg</b></div><div><span>每日热量</span><b>{profile.dailyCalories.min}–{profile.dailyCalories.max} kcal</b></div><div><span>蛋白质 / 纤维</span><b>{profile.proteinTargetG} g / {profile.fiberTargetG} g</b></div><div><span>设备</span><b>{profile.equipment.join("、")}</b></div></div>
        </section>
        <section className="card settings-section">
          <div className="settings-title"><HardDrive/><div><h2>存储与附件</h2><p>结构化状态已进入 SQLite；附件体积统计、缩略图和 2 GB 提醒尚待接通。</p></div></div>
          <div className="storage-bar"><i style={{width:"0%"}}/></div><div className="storage-legend"><span>结构化数据 <b>SQLite</b></span><span>审计事件 <b>{auditEventCount} 条</b></span></div>
        </section>
        <section className="card settings-section">
          <div className="settings-title"><LockKeyhole/><div><h2>数据库加密备份与恢复验证</h2><p>Argon2id + AES-256-GCM；口令不会被保存，忘记后无法恢复。附件打包与自动轮换尚未启用。</p></div></div>
          <div className="button-row"><button className="button primary" onClick={() => openBackup("create")}><LockKeyhole size={16}/> 创建加密备份</button><button className="button secondary" onClick={() => openBackup("verify")}><Shield size={16}/> 验证 / 暂存恢复</button></div>
          <button className="text-button export-link" onClick={exportJson}><Download size={15}/> 导出 JSON（未加密）</button>
        </section>
        <section className="card settings-section ai-config-section">
          <div className="settings-title"><KeyRound/><div><h2>AI 提供商与费用上限</h2><p>密钥仅存 Windows 凭据管理器；达到软上限后回退手工模式。</p></div></div>
          <div className="form compact-form">
            <label>提供商<select value={aiSettings.provider} onChange={(event) => changeProvider(event.target.value as AiProviderId)}>{aiProviders.map((provider) => <option key={provider.id} value={provider.id}>{provider.label}</option>)}</select></label>
            <label>接口地址<input value={aiSettings.baseUrl} onChange={(event) => setAiSettings({ baseUrl: event.target.value, cloudEnabled: false })}/></label>
            <div className="form-grid"><label>模型名称<input value={aiSettings.model} placeholder="由你配置" onChange={(event) => setAiSettings({ model: event.target.value, cloudEnabled: false })}/></label><label>月度软上限（元）<input type="number" min="0" step="1" value={aiSettings.monthlyLimitCny ?? ""} onChange={(event) => setAiSettings({ monthlyLimitCny: event.target.value === "" ? undefined : Number(event.target.value) })}/></label></div>
            <label>API Key<input type="password" autoComplete="off" value={apiKey} placeholder={credentialConfigured ? "已安全保存；输入可替换" : "不会写入应用数据库"} onChange={(event) => setApiKey(event.target.value)}/></label>
            {providerErrors.length > 0 && <p className="form-error">{providerErrors.join("；")}</p>}
            <div className="credential-row"><span className={`status-pill ${credentialConfigured ? "success" : "neutral"}`}>{credentialConfigured ? "凭据已保存" : "未配置凭据"}</span><span>本月估算 ¥{aiSettings.estimatedSpendCny.toFixed(2)}{aiSettings.monthlyLimitCny === undefined ? " · 不限额" : ` / ¥${aiSettings.monthlyLimitCny.toFixed(2)}`}</span></div>
            <div className="button-row"><button className="button primary" disabled={credentialBusy || !apiKey} onClick={saveCredential}>{credentialBusy ? "处理中…" : "安全保存"}</button>{credentialConfigured && <button className="button danger" disabled={credentialBusy} onClick={deleteCredential}><Trash2 size={15}/> 删除凭据</button>}</div>
            {budget.exhausted && <p className="form-error">本月软上限已达到，云端调用已停用；手工记录不受影响。</p>}
          </div>
        </section>
        <section className="card settings-section">
          <div className="settings-title"><Shield/><div><h2>外部助手</h2><p>MCP 默认关闭；首个小版本只开放摘要读取和草稿创建。</p></div></div><span className="status-pill neutral">尚未启用</span>
        </section>
      </div>
      <section className="danger-zone card"><div><h3>重置本地演示数据</h3><p>清除 SQLite 中的应用状态并恢复标准菜谱和初始库存；附件和 Windows 凭据不会删除。</p></div><button className="button danger" onClick={() => { if (confirm("确定重置演示数据？")) resetDemo(); }}><RotateCcw size={16}/> 重置</button></section>

      {backupMode && <Modal title={backupMode === "create" ? "创建加密备份" : "验证或暂存恢复副本"} onClose={() => !busy && setBackupMode(null)}>
        <form className="form" onSubmit={(event) => { event.preventDefault(); void submitBackup(); }}>
          <p className="form-hint">备份口令不会写入文件或凭据存储。忘记口令后没有找回渠道。</p>
          <label>备份口令（至少 10 个字符）<input type="password" autoComplete="new-password" value={passphrase} onChange={(event) => setPassphrase(event.target.value)} required minLength={10}/></label>
          {backupMode === "create" && <label>再次输入口令<input type="password" autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required minLength={10}/></label>}
          {backupMode === "verify" && <label className="checkbox-label"><input type="checkbox" checked={stageRestore} onChange={(event) => setStageRestore(event.target.checked)}/><span>将通过完整性检查的数据库保留为明文恢复暂存副本（不会覆盖当前数据，完成后请及时清理）</span></label>}
          {message && <p className="backup-message">{message}</p>}
          {backupResult && <div className="backup-result"><b>完整性：{backupResult.integrity}</b><span>数据库：{formatBytes(backupResult.databaseBytes)}</span><span>时间：{new Date(backupResult.createdAt).toLocaleString("zh-CN")}</span>{backupResult.stagedRestorePath && <><span>暂存：{backupResult.stagedRestorePath}</span><div className="button-row"><button type="button" className="button success small" disabled={busy || restoreScheduled} onClick={() => void scheduleRestore()}><RotateCcw size={14}/> {restoreScheduled ? "已安排下次启动恢复" : "下次启动时安全恢复"}</button><button type="button" className="button danger small" disabled={busy || restoreScheduled} onClick={() => void discardStagedRestore()}><Trash2 size={14}/> 清理明文暂存副本</button></div></>}</div>}
          <button className="button primary wide" disabled={busy}>{busy ? "正在执行加密与完整性检查…" : backupMode === "create" ? "选择位置并创建" : "选择备份并验证"}</button>
        </form>
      </Modal>}
    </div>
  );
}
