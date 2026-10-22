import { invoke } from "@tauri-apps/api/core";
import { Database, Gauge, HardDrive, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { PageHeader } from "../components/PageHeader";
import { useAppStore } from "../store/appStore";
import { DataExportPanel } from "../components/DataExportPanel";
import { RuntimeDiagnostics } from "../components/RuntimeDiagnostics";
import { isTauriRuntime } from "../data/storage";
import { useEnergyUnit } from "../hooks/useEnergyUnit";
import { energyUnitLabels, toDisplayEnergy } from "../domain/energyDisplay";
import type { EnergyUnitPref } from "../domain/preferences";

interface DomainStorageStatus {
  initialized: boolean;
  persistVersion?: number | null;
  revision?: number | null;
  entityCount: number;
  commandCount: number;
  updatedAt?: string | null;
}

const isTauri = isTauriRuntime;

export function SettingsPage() {
  const profile = useAppStore((state) => state.profile);
  const [energyUnit, setEnergyUnit] = useEnergyUnit();
  const auditEventCount = useAppStore((state) => state.auditEvents.length);
  const resetDemo = useAppStore((state) => state.resetDemo);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [storageStatus, setStorageStatus] = useState<DomainStorageStatus | null>(null);
  const [upgradeReport, setUpgradeReport] = useState<{ reconciled: boolean; backupPath?: string | null } | null>(null);

  useEffect(() => {
    if (!isTauri()) return;
    void invoke<{ reconciled: boolean; backupPath?: string | null }>("get_domain_upgrade_report").then(setUpgradeReport).catch((cause) => setMessage(String(cause)));
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    void invoke<DomainStorageStatus>("get_domain_storage_status")
      .then(setStorageStatus)
      .catch(() => setStorageStatus(null));
  }, [auditEventCount]);

  return (
    <div className="page">
      <PageHeader eyebrow="本地优先" title="设置与数据" description="目标、显示偏好与本地数据都可查看、可导出、可重置。" />
      {message && <div className="settings-notice card" role="status">{message}</div>}
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
            <p className="form-hint">换算系数与标签校验同源：1 kcal = 4.184 kJ。切换后饮食、今日、趋势的显示单位一致；导出与备份不受影响。</p>
          </div>
        </section>
        <section className="card settings-section">
          <div className="settings-title"><HardDrive/><div><h2>数据与导出</h2><p>本地 SQLite 记录可导出为未加密 JSON；导出不会修改记录。</p></div></div>
          <div className="storage-bar"><i style={{width:"0%"}}/></div>
          <div className="storage-legend"><span>领域仓库 <b>{storageStatus?.initialized ? `修订 ${storageStatus.revision}` : "等待首次写入"}</b></span><span>实体 / 命令 / 审计 <b>{storageStatus?.entityCount ?? 0} / {storageStatus?.commandCount ?? 0} / {auditEventCount} 条</b></span></div>
          {upgradeReport && <p className="form-hint">升级对账：{upgradeReport.reconciled ? "记录与营养一致" : "需要复核"}{upgradeReport.backupPath ? `。升级前本地明文安全副本：${upgradeReport.backupPath}` : "。首次初始化，无旧数据库需要备份。"}</p>}
          <DataExportPanel/>
        </section>
      </div>
      <section className="danger-zone card"><div><h3>重置本地记录</h3><p>清除应用记录和命令回执。桌面版回到空白记录并保留标准菜谱。</p></div><button className="button danger" disabled={busy} onClick={async () => { if (!confirm("确定清除这台电脑上的全部应用记录？建议先导出 JSON 备份。")) return; setBusy(true); try { await resetDemo(); setMessage("本地记录已重置。"); } catch (cause) { setMessage(String(cause)); } finally { setBusy(false); } }}><RotateCcw size={16}/> 重置</button></section>
    </div>
  );
}
