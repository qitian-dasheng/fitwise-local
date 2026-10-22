import { invoke } from "@tauri-apps/api/core";
import { Database, Gauge, HardDrive, KeyRound, LockKeyhole, RotateCcw, Shield, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { aiBudgetState, aiProviders, providerDescriptor, validateProviderSettings } from "../ai/providers";
import { Modal } from "../components/Modal";
import { PageHeader } from "../components/PageHeader";
import type { AiProviderId } from "../domain/types";
import { useAppStore } from "../store/appStore";
import { DataExportPanel } from "../components/DataExportPanel";
import { RuntimeDiagnostics } from "../components/RuntimeDiagnostics";
import { isTauriRuntime } from "../data/storage";
import { useConfirmedAction } from "../components/useConfirmedAction";
import { ArtifactStoragePanel } from "../components/InputArtifacts";
import { useEnergyUnit } from "../hooks/useEnergyUnit";
import { energyUnitLabels, toDisplayEnergy } from "../domain/energyDisplay";
import type { EnergyUnitPref } from "../domain/preferences";

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

interface DomainStorageStatus {
  initialized: boolean;
  persistVersion?: number | null;
  revision?: number | null;
  entityCount: number;
  commandCount: number;
  updatedAt?: string | null;
}

const isTauri = isTauriRuntime;
const formatBytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(2)} MB`;

export function SettingsPage() {
  const profile = useAppStore((state) => state.profile);
  const [energyUnit, setEnergyUnit] = useEnergyUnit();
  const savedAiSettings = useAppStore((state) => state.aiSettings);
  const [aiSettings, setAiDraft] = useState(savedAiSettings);
  const configAction = useConfirmedAction();
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
  const [storageStatus, setStorageStatus] = useState<DomainStorageStatus | null>(null);
  const [upgradeReport, setUpgradeReport] = useState<{ reconciled: boolean; backupPath?: string | null } | null>(null);
  const budget = aiBudgetState(aiSettings);
  const providerErrors = validateProviderSettings(aiSettings);

  useEffect(() => { setAiDraft(savedAiSettings); }, [savedAiSettings]);

  useEffect(() => {
    if (!isTauri()) return;
    void invoke<{ reconciled: boolean; backupPath?: string | null }>("get_domain_upgrade_report").then(setUpgradeReport).catch((cause) => setMessage(String(cause)));
  }, []);

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

  useEffect(() => {
    if (!isTauri()) return;
    void invoke<DomainStorageStatus>("get_domain_storage_status")
      .then(setStorageStatus)
      .catch(() => setStorageStatus(null));
  }, [auditEventCount]);

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
    setAiDraft((current) => ({ ...current, provider, baseUrl: descriptor.defaultBaseUrl, cloudEnabled: false }));
    setApiKey("");
  }

  async function saveSettings(cloudEnabled = false) {
    const settings = { provider: aiSettings.provider, baseUrl: aiSettings.baseUrl, model: aiSettings.model, monthlyLimitCny: aiSettings.monthlyLimitCny, cloudEnabled };
    return configAction.run(JSON.stringify(settings), (id) => setAiSettings(settings, id));
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
      const config = await saveSettings(false);
      if (config.error) throw new Error(config.error);
      const status = await invoke<{ configured: boolean }>("save_ai_credential", { provider: aiSettings.provider, apiKey });
      setCredentialConfigured(status.configured);
      setApiKey("");
      const enabled = await setAiSettings({ cloudEnabled: true });
      if (enabled.error) throw new Error(`凭据已保存，但配置未更新：${enabled.error}`);
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
      const disabled = await setAiSettings({ cloudEnabled: false });
      if (disabled.error) throw new Error(`凭据已删除，但配置未更新：${disabled.error}`);
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
        <RuntimeDiagnostics/>
        <section className="card settings-section">
          <div className="settings-title"><Database/><div><h2>个人目标</h2><p>修改目标时创建新版本，不回写历史。</p></div></div>
          <div className="settings-list"><div><span>阶段体重</span><b>{profile.startWeightKg} → {profile.targetWeightKg} kg</b></div><div><span>每日热量</span><b>{Math.round(toDisplayEnergy(profile.dailyCalories.min, energyUnit))}–{Math.round(toDisplayEnergy(profile.dailyCalories.max, energyUnit))} {energyUnitLabels[energyUnit]}</b></div><div><span>蛋白质 / 纤维</span><b>{profile.proteinTargetG} g / {profile.fiberTargetG} g</b></div><div><span>设备</span><b>{profile.equipment.join("、")}</b></div></div>
        </section>
        <section className="card settings-section">
          <div className="settings-title"><Gauge/><div><h2>显示偏好</h2><p>只影响界面显示；数据库统一以 kcal 存储，录入表单保持 kcal 口径不混排。</p></div></div>
          <div className="form compact-form">
            <label>能量单位<select value={energyUnit} data-testid="energy-unit-select" onChange={(event) => setEnergyUnit(event.target.value as EnergyUnitPref)}><option value="kcal">千卡 kcal（默认）</option><option value="kJ">千焦 kJ</option></select></label>
            <p className="form-hint">换算系数与标签校验同源：1 kcal = 4.184 kJ。切换后饮食、今日、趋势、计划与标签预览的显示单位一致；导出与备份不受影响。</p>
          </div>
        </section>
        <section className="card settings-section">
          <div className="settings-title"><HardDrive/><div><h2>存储与附件</h2><p>附件原件、缩略图和接收记录由 SQLite 事务保存；列表按需读取小预览。</p></div></div>
          <ArtifactStoragePanel/>
          <div className="storage-bar"><i style={{width:"0%"}}/></div><div className="storage-legend"><span>领域仓库 <b>{storageStatus?.initialized ? `修订 ${storageStatus.revision}` : "等待首次写入"}</b></span><span>实体 / 命令 / 审计 <b>{storageStatus?.entityCount ?? 0} / {storageStatus?.commandCount ?? 0} / {auditEventCount} 条</b></span></div>
          {upgradeReport && <p className="form-hint">升级对账：{upgradeReport.reconciled ? "记录、营养与库存一致" : "需要复核"}{upgradeReport.backupPath ? `。升级前本地明文安全副本：${upgradeReport.backupPath}` : "。首次初始化，无旧数据库需要备份。"}</p>}
        </section>
        <section className="card settings-section">
          <div className="settings-title"><LockKeyhole/><div><h2>数据库与附件加密备份</h2><p>Argon2id + AES-256-GCM；包含已入库原件与派生图，恢复时逐一核对哈希。忘记口令无法恢复；自动日周轮换尚未启用。</p></div></div>
          <div className="button-row"><button className="button primary" onClick={() => openBackup("create")}><LockKeyhole size={16}/> 创建加密备份</button><button className="button secondary" onClick={() => openBackup("verify")}><Shield size={16}/> 验证 / 暂存恢复</button></div>
          <DataExportPanel/>
        </section>
        <section className="card settings-section ai-config-section">
          <div className="settings-title"><KeyRound/><div><h2>AI 提供商与费用上限</h2><p>密钥仅存 Windows 凭据管理器；达到软上限后回退手工模式。</p></div></div>
          <div className="form compact-form">
            <label>提供商<select value={aiSettings.provider} onChange={(event) => changeProvider(event.target.value as AiProviderId)}>{aiProviders.map((provider) => <option key={provider.id} value={provider.id}>{provider.label}</option>)}</select></label>
            <label>接口地址<input value={aiSettings.baseUrl} onChange={(event) => setAiDraft({ ...aiSettings, baseUrl: event.target.value, cloudEnabled: false })}/></label>
            <div className="form-grid"><label>模型名称<input value={aiSettings.model} placeholder="由你配置" onChange={(event) => setAiDraft({ ...aiSettings, model: event.target.value, cloudEnabled: false })}/></label><label>月度软上限（元）<input type="number" min="0" step="1" value={aiSettings.monthlyLimitCny ?? ""} onChange={(event) => setAiDraft({ ...aiSettings, monthlyLimitCny: event.target.value === "" ? undefined : Number(event.target.value) })}/></label></div>
            <label>API Key<input type="password" autoComplete="off" value={apiKey} placeholder={credentialConfigured ? "已安全保存；输入可替换" : "不会写入应用数据库"} onChange={(event) => setApiKey(event.target.value)}/></label>
            {providerErrors.length > 0 && <p className="form-error">{providerErrors.join("；")}</p>}
            {configAction.message && <p className="form-error" role="alert">{configAction.message}</p>}
            <div className="credential-row"><span className={`status-pill ${credentialConfigured ? "success" : "neutral"}`}>{credentialConfigured ? "凭据已保存" : "未配置凭据"}</span><span>本月估算 ¥{aiSettings.estimatedSpendCny.toFixed(2)}{aiSettings.monthlyLimitCny === undefined ? " · 不限额" : ` / ¥${aiSettings.monthlyLimitCny.toFixed(2)}`}</span></div>
            <div className="button-row"><button className="button secondary" disabled={configAction.busy || credentialBusy || providerErrors.length > 0} onClick={async () => { const result = await saveSettings(false); if (!result.error) setMessage("AI 配置已保存。真实模型调用尚待接通。"); }}>保存配置</button><button className="button primary" disabled={configAction.busy || credentialBusy || !apiKey} onClick={saveCredential}>{credentialBusy ? "处理中…" : "安全保存凭据"}</button>{credentialConfigured && <button className="button danger" disabled={credentialBusy} onClick={deleteCredential}><Trash2 size={15}/> 删除凭据</button>}</div>
            {budget.exhausted && <p className="form-error">本月软上限已达到，云端调用已停用；手工记录不受影响。</p>}
          </div>
        </section>
        <section className="card settings-section">
          <div className="settings-title"><Shield/><div><h2>外部助手</h2><p>MCP 默认关闭；首个小版本只开放摘要读取和草稿创建。</p></div></div><span className="status-pill neutral">尚未启用</span>
        </section>
      </div>
      <section className="danger-zone card"><div><h3>重置本地记录</h3><p>清除应用记录和命令回执。桌面版回到空白记录并保留标准菜谱；附件和 Windows 凭据保留。</p></div><button className="button danger" disabled={busy} onClick={async () => { if (!confirm("确定清除这台电脑上的全部应用记录？建议先创建加密备份。")) return; setBusy(true); try { await resetDemo(); setMessage("本地记录已重置。"); } catch (cause) { setMessage(String(cause)); } finally { setBusy(false); } }}><RotateCcw size={16}/> 重置</button></section>

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
