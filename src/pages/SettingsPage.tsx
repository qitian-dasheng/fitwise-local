import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { Activity, ChevronRight, Database, HardDrive, RotateCcw, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { useAppStore } from "../store/appStore";
import { useConfirmedAction } from "../components/useConfirmedAction";
import { validateTargetProfileInput } from "../domain/targets";
import type { TargetProfileInput } from "../domain/types";
import { Modal } from "../components/Modal";
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

/** 0.9.4 设置行：图标 + 标题 + 当前值摘要，点击弹窗承载原卡片全部内容。 */
function SettingsRow({
  icon, title, summary, onClick, danger,
}: { icon: React.ReactNode; title: string; summary: string; onClick: () => void; danger?: boolean }) {
  return (
    <button type="button" className={`settings-row${danger ? " danger" : ""}`} onClick={onClick}>
      {icon}
      <span className="settings-row-main">
        <b>{title}</b>
        <span>{summary}</span>
      </span>
      <ChevronRight size={15} className="chevron" />
    </button>
  );
}

export function SettingsPage() {
  const profile = useAppStore((state) => state.profile);
  const setTargetProfile = useAppStore((state) => state.setTargetProfile);
  const [targetForm, setTargetForm] = useState<null | { min: string; target: string; max: string; protein: string; fiber: string; weight: string }>(null);
  const targetAction = useConfirmedAction();
  const auditEventCount = useAppStore((state) => state.auditEvents.length);
  const resetDemo = useAppStore((state) => state.resetDemo);
  const [busy, setBusy] = useState(false);
  const [resetAck, setResetAck] = useState(false);
  const [message, setMessage] = useState("");
  const [storageStatus, setStorageStatus] = useState<DomainStorageStatus | null>(null);
  const [upgradeReport, setUpgradeReport] = useState<{ reconciled: boolean; backupPath?: string | null } | null>(null);
  const [version, setVersion] = useState("");
  const [openRow, setOpenRow] = useState<null | "target" | "data" | "update" | "diagnostics" | "reset">(null);

  useEffect(() => {
    if (!isTauri()) return;
    void getVersion().then(setVersion, () => setVersion("未知"));
    void invoke<{ reconciled: boolean; backupPath?: string | null }>("get_domain_upgrade_report").then(setUpgradeReport).catch((cause) => setMessage(String(cause)));
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    void invoke<DomainStorageStatus>("get_domain_storage_status")
      .then(setStorageStatus)
      .catch(() => setStorageStatus(null));
  }, [auditEventCount]);

  async function runReset() {
    setBusy(true);
    try {
      const summary = await resetDemo();
      const kept = `保留食材库 ${summary.keptFoodDefinitions} 项、营养版本 ${summary.keptFoodDefinitionVersions} 个、菜谱 ${summary.keptRecipes} 道、个人目标与显示偏好`;
      const cleared = `清除饮食 ${summary.clearedMeals} 条、身体记录 ${summary.clearedMeasurements} 条、运动 ${summary.clearedWorkouts} 条、打卡 ${summary.clearedCheckIns} 条、审计 ${summary.clearedAuditEvents} 条、命令回执 ${summary.clearedCommandReceipts} 条`;
      const dropped = summary.droppedRecipes.length > 0 ? `；剔除失效菜谱 ${summary.droppedRecipes.length} 道（${summary.droppedRecipes.join("、")}）` : "";
      setMessage(`本地记录已重置：${kept}；${cleared}${dropped}。`);
      setOpenRow(null);
    } catch (cause) {
      setMessage(String(cause));
    } finally {
      setBusy(false);
      setResetAck(false);
    }
  }

  return (
    <div className="page">
      <header className="ui-page-head"><div><div className="date">本地优先 · 数据不出本机</div><h1>设置与数据</h1></div></header>
      {message && <div className="ui-card settings-notice" role="status">{message}</div>}
      <div className="ui-card settings-menu">
        <SettingsRow
          icon={<Database size={17} />}
          title="个人目标"
          summary={`目标体重 ${profile.targetWeightKg} kg · ${profile.dailyCalories.min}–${profile.dailyCalories.max} kcal · 蛋白 ${profile.proteinTargetG} g`}
          onClick={() => setOpenRow("target")}
        />
        <SettingsRow
          icon={<HardDrive size={17} />}
          title="数据与导出"
          summary={storageStatus?.initialized ? `领域仓库修订 ${storageStatus.revision} · 实体 ${storageStatus.entityCount} · 审计 ${auditEventCount} 条` : "等待首次写入 · 可导出 JSON 备份"}
          onClick={() => setOpenRow("data")}
        />
        <SettingsRow
          icon={<ShieldCheck size={17} />}
          title="关于与更新"
          summary={isTauri() ? (version ? `当前版本 ${version} · 更新检查是唯一网络行为` : "读取版本中…") : "浏览器预览 · 无桌面更新能力"}
          onClick={() => setOpenRow("update")}
        />
        <SettingsRow
          icon={<Activity size={17} />}
          title="运行与保存诊断"
          summary="版本 / 进程 / 数据路径 / 仓库状态 · 只读查询"
          onClick={() => setOpenRow("diagnostics")}
        />
        <SettingsRow
          danger
          icon={<RotateCcw size={17} />}
          title="重置本地记录"
          summary="清除饮食、身体、运动与打卡记录 · 保留食材库、菜谱与目标"
          onClick={() => { setResetAck(false); setOpenRow("reset"); }}
        />
      </div>

      {openRow === "target" && (
        <Modal title="个人目标" onClose={() => { setTargetForm(null); targetAction.setMessage(""); setOpenRow(null); }}>
          <p className="form-hint">修改只影响当前显示与之后的判定；旧值保留在审计链里，不回写历史。</p>
          {targetForm ? (
            <form className="form" onSubmit={async (event) => {
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
                <button className="button secondary small" type="button" disabled={targetAction.busy} onClick={() => { setTargetForm(null); targetAction.setMessage(""); }}>取消编辑</button>
              </div>
            </form>
          ) : (
            <>
              <div className="settings-list"><div><span>阶段体重</span><b>{profile.startWeightKg} → {profile.targetWeightKg} kg</b></div><div><span>每日热量</span><b>{profile.dailyCalories.min}–{profile.dailyCalories.max} kcal</b></div><div><span>蛋白质 / 纤维</span><b>{profile.proteinTargetG} g / {profile.fiberTargetG} g</b></div><div><span>设备</span><b>{profile.equipment.join("、")}</b></div></div>
              <div className="button-row">
                <button className="button secondary small" onClick={() => setTargetForm({
                  min: String(profile.dailyCalories.min), target: String(profile.dailyCalories.target), max: String(profile.dailyCalories.max),
                  protein: String(profile.proteinTargetG), fiber: String(profile.fiberTargetG), weight: String(profile.targetWeightKg),
                })}>编辑目标</button>
              </div>
            </>
          )}
        </Modal>
      )}

      {openRow === "data" && (
        <Modal title="数据与导出" onClose={() => setOpenRow(null)}>
          <p className="form-hint">本地 SQLite 记录可导出为未加密 JSON；导出不会修改记录。</p>
          <div className="storage-bar"><i style={{width:"0%"}}/></div>
          <div className="storage-legend"><span>领域仓库 <b>{storageStatus?.initialized ? `修订 ${storageStatus.revision}` : "等待首次写入"}</b></span><span>实体 / 命令 / 审计 <b>{storageStatus?.entityCount ?? 0} / {storageStatus?.commandCount ?? 0} / {auditEventCount} 条</b></span></div>
          {upgradeReport && <p className="form-hint">升级对账：{upgradeReport.reconciled ? "记录与营养一致" : "需要复核"}{upgradeReport.backupPath ? `。升级前本地明文安全副本：${upgradeReport.backupPath}` : "。首次初始化，无旧数据库需要备份。"}</p>}
          <DataExportPanel/>
        </Modal>
      )}

      {openRow === "update" && (
        <Modal title="关于与更新" onClose={() => setOpenRow(null)}>
          <UpdatePanel/>
        </Modal>
      )}

      {openRow === "diagnostics" && (
        <Modal title="运行与保存诊断" onClose={() => setOpenRow(null)}>
          <RuntimeDiagnostics/>
        </Modal>
      )}

      {openRow === "reset" && (
        <Modal title="重置本地记录" onClose={() => setOpenRow(null)}>
          <p className="form-hint">清除全部饮食、体重/腰围/体脂、运动、打卡记录、审计事件与命令回执；保留食材库与营养版本、引用有效的菜谱、个人目标与显示偏好（能量单位/钠开关/趋势区间）。重置不可撤销，建议先在「数据与导出」里导出 JSON 备份。</p>
          <label className="checkbox-label"><input type="checkbox" checked={resetAck} onChange={(event) => setResetAck(event.target.checked)} /><span>我已理解重置不可撤销，并已确认需要清除以上记录</span></label>
          <div className="button-row">
            <button className="button danger" disabled={!resetAck || busy} onClick={() => void runReset()}>
              <RotateCcw size={15}/> {busy ? "正在重置…" : "重置本地记录"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
