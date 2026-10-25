import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { Activity, Bot, ChevronRight, Database, HardDrive, RotateCcw, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { useAppStore } from "../store/appStore";
import { Modal } from "../components/Modal";
import { TargetGoalModal } from "../components/TargetGoalModal";
import { AiSettingsModal } from "../components/AiSettingsModal";
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

type SettingsRowKey = "target" | "data" | "update" | "diagnostics" | "reset" | "ai";

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
  const auditEventCount = useAppStore((state) => state.auditEvents.length);
  const resetDemo = useAppStore((state) => state.resetDemo);
  const [busy, setBusy] = useState(false);
  const [resetAck, setResetAck] = useState(false);
  const [message, setMessage] = useState("");
  const [storageStatus, setStorageStatus] = useState<DomainStorageStatus | null>(null);
  const [upgradeReport, setUpgradeReport] = useState<{ reconciled: boolean; backupPath?: string | null } | null>(null);
  const [version, setVersion] = useState("");
  const [openRow, setOpenRow] = useState<null | SettingsRowKey>(null);
  const [aiSettingsOpen, setAiSettingsOpen] = useState(false);

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
          icon={<Bot size={17} />}
          title="AI 采集"
          summary="用 Ollama 从自然语言生成饮食草稿（默认关闭，仅本机）"
          onClick={() => setAiSettingsOpen(true)}
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

      {openRow === "target" && <TargetGoalModal profile={profile} onClose={() => setOpenRow(null)} />}

      {aiSettingsOpen && <AiSettingsModal onClose={() => setAiSettingsOpen(false)} />}
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
