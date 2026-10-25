import { invoke } from "@tauri-apps/api/core";
import { Database, Gauge, HardDrive, PencilLine, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { useAppStore } from "../store/appStore";
import { useConfirmedAction } from "../components/useConfirmedAction";
import { targetFieldsOf, validateTargetProfileInput } from "../domain/targets";
import type { TargetProfileInput } from "../domain/types";
import { DataExportPanel } from "../components/DataExportPanel";
import { RuntimeDiagnostics } from "../components/RuntimeDiagnostics";
import { UpdatePanel } from "../components/UpdatePanel";
import { isTauriRuntime } from "../data/storage";

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
  const setTargetProfile = useAppStore((state) => state.setTargetProfile);
  const [targetForm, setTargetForm] = useState<null | { min: string; target: string; max: string; protein: string; fiber: string; weight: string }>(null);
  const targetAction = useConfirmedAction();
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
      <header className="ui-page-head"><div><div className="date">本地优先 · 数据不出本机</div><h1>设置与数据</h1></div></header>
      {message && <div className="ui-card settings-notice" role="status">{message}</div>}
      <div className="settings-grid">
        <RuntimeDiagnostics/>
        <section className="ui-card settings-section">
          <div className="settings-title"><Database/><div><h2>个人目标</h2><p>修改只影响当前显示与之后的判定；旧值保留在审计链里，不回写历史。</p></div></div>
          {targetForm ? (
            <form className="form compact-form" onSubmit={async (event) => {
              event.preventDefault();
              const input: TargetProfileInput = {
                dailyCalories: { min: Number(targetForm.min), target: Number(targetForm.target), max: Number(targetForm.max) },
                proteinTargetG: Number(targetForm.protein),
                fiberTargetG: Number(targetForm.fiber),
                targetWeightKg: Number(targetForm.weight),
              };
              const checked = validateTargetProfileInput(input);
              if (checked.error || !checked.payload) { targetAction.setMessage(checked.error ?? "目标值无效。"); return; }
              const result = await targetAction.run(JSON.stringify(input), (id) => setTargetProfile(checked.payload!, id));
              if (!result.error) { setTargetForm(null); targetAction.setMessage(""); }
            }}>
              <div className="form-grid">
                <label><span>热量下限 kcal</span><input type="number" required min={500} max={8000} value={targetForm.min} onChange={(event) => setTargetForm({ ...targetForm, min: event.target.value })}/></label>
                <label><span>热量目标 kcal</span><input type="number" required min={500} max={8000} value={targetForm.target} onChange={(event) => setTargetForm({ ...targetForm, target: event.target.value })}/></label>
                <label><span>热量上限 kcal</span><input type="number" required min={500} max={8000} value={targetForm.max} onChange={(event) => setTargetForm({ ...targetForm, max: event.target.value })}/></label>
                <label><span>蛋白质目标 g</span><input type="number" required min={1} max={500} value={targetForm.protein} onChange={(event) => setTargetForm({ ...targetForm, protein: event.target.value })}/></label>
                <label><span>纤维目标 g</span><input type="number" required min={0} max={200} value={targetForm.fiber} onChange={(event) => setTargetForm({ ...targetForm, fiber: event.target.value })}/></label>
                <label><span>目标体重 kg</span><input type="number" required min={20} max={400} step="0.01" value={targetForm.weight} onChange={(event) => setTargetForm({ ...targetForm, weight: event.target.value })}/></label>
              </div>
              <p className="form-hint">区间需满足 下限 ≤ 目标 ≤ 上限；目标体重最多两位小数。</p>
              {targetAction.message && <p className="form-error" role="alert">{targetAction.message}</p>}
              <div className="button-row">
                <button className="button primary small" type="submit" disabled={targetAction.busy}>保存目标</button>
                <button className="button secondary small" type="button" disabled={targetAction.busy} onClick={() => { setTargetForm(null); targetAction.setMessage(""); }}>取消</button>
              </div>
            </form>
          ) : (
            <>
              <div className="settings-list"><div><span>阶段体重</span><b>{profile.startWeightKg} → {profile.targetWeightKg} kg</b></div><div><span>每日热量</span><b>{profile.dailyCalories.min}–{profile.dailyCalories.max} kcal</b></div><div><span>蛋白质 / 纤维</span><b>{profile.proteinTargetG} g / {profile.fiberTargetG} g</b></div><div><span>设备</span><b>{profile.equipment.join("、")}</b></div></div>
              <button className="button secondary small" onClick={() => setTargetForm({
                min: String(profile.dailyCalories.min), target: String(profile.dailyCalories.target), max: String(profile.dailyCalories.max),
                protein: String(profile.proteinTargetG), fiber: String(profile.fiberTargetG), weight: String(profile.targetWeightKg),
              })}><PencilLine size={15}/> 编辑目标</button>
            </>
          )}
        </section>
        <section className="ui-card settings-section">
          <div className="settings-title"><HardDrive/><div><h2>数据与导出</h2><p>本地 SQLite 记录可导出为未加密 JSON；导出不会修改记录。</p></div></div>
          <div className="storage-bar"><i style={{width:"0%"}}/></div>
          <div className="storage-legend"><span>领域仓库 <b>{storageStatus?.initialized ? `修订 ${storageStatus.revision}` : "等待首次写入"}</b></span><span>实体 / 命令 / 审计 <b>{storageStatus?.entityCount ?? 0} / {storageStatus?.commandCount ?? 0} / {auditEventCount} 条</b></span></div>
          {upgradeReport && <p className="form-hint">升级对账：{upgradeReport.reconciled ? "记录与营养一致" : "需要复核"}{upgradeReport.backupPath ? `。升级前本地明文安全副本：${upgradeReport.backupPath}` : "。首次初始化，无旧数据库需要备份。"}</p>}
          <DataExportPanel/>
        </section>
        <UpdatePanel/>
      </div>
      <section className="ui-card danger-zone"><div><h3>重置本地记录</h3><p>清除全部饮食、体重/腰围/体脂、运动、打卡记录、审计事件与命令回执；保留食材库与营养版本、引用有效的菜谱、个人目标与显示偏好（能量单位/钠开关/趋势区间）。重置不可撤销，建议先导出 JSON 备份。</p></div><button className="button danger" disabled={busy} onClick={async () => { if (!confirm("确定重置本地记录？将清除全部饮食、身体、运动、打卡记录与命令回执；保留食材库、引用有效的菜谱、个人目标与显示偏好。建议先导出 JSON 备份。")) return; setBusy(true); try { const summary = await resetDemo(); const kept = `保留食材库 ${summary.keptFoodDefinitions} 项、营养版本 ${summary.keptFoodDefinitionVersions} 个、菜谱 ${summary.keptRecipes} 道、个人目标与显示偏好`; const cleared = `清除饮食 ${summary.clearedMeals} 条、身体记录 ${summary.clearedMeasurements} 条、运动 ${summary.clearedWorkouts} 条、打卡 ${summary.clearedCheckIns} 条、审计 ${summary.clearedAuditEvents} 条、命令回执 ${summary.clearedCommandReceipts} 条`; const dropped = summary.droppedRecipes.length > 0 ? `；剔除失效菜谱 ${summary.droppedRecipes.length} 道（${summary.droppedRecipes.join("、")}）` : ""; setMessage(`本地记录已重置：${kept}；${cleared}${dropped}。`); } catch (cause) { setMessage(String(cause)); } finally { setBusy(false); } }}><RotateCcw size={16}/> 重置</button></section>
    </div>
  );
}
