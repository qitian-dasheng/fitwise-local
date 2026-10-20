import { Database, Download, HardDrive, KeyRound, RotateCcw, Shield } from "lucide-react";
import { PageHeader } from "../components/PageHeader";
import { useAppStore } from "../store/appStore";

export function SettingsPage() {
  const profile = useAppStore((state) => state.profile);
  const resetDemo = useAppStore((state) => state.resetDemo);
  function exportJson() {
    const state = useAppStore.getState();
    const data = {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      app: "Fitwise Local",
      profile: state.profile,
      meals: state.meals,
      checkIns: state.checkIns,
      measurements: state.measurements,
      workouts: state.workouts,
      recipes: state.recipes,
      batches: state.batches,
      inventory: state.inventory,
      inventoryMovements: state.inventoryMovements,
      purchases: state.purchases,
      inbox: state.inbox,
      plans: state.plans,
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `fitwise-export-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }
  return <div className="page"><PageHeader eyebrow="本地优先" title="设置与数据" description="密钥、备份和外部助手权限都应可见、可撤销、可审计。"/><div className="settings-grid"><section className="card settings-section"><div className="settings-title"><Database/><div><h2>个人目标</h2><p>修改目标时创建新版本，不回写历史。</p></div></div><div className="settings-list"><div><span>阶段体重</span><b>{profile.startWeightKg} → {profile.targetWeightKg} kg</b></div><div><span>每日热量</span><b>{profile.dailyCalories.min}–{profile.dailyCalories.max} kcal</b></div><div><span>蛋白质 / 纤维</span><b>{profile.proteinTargetG} g / {profile.fiberTargetG} g</b></div><div><span>设备</span><b>{profile.equipment.join("、")}</b></div></div></section><section className="card settings-section"><div className="settings-title"><HardDrive/><div><h2>存储与附件</h2><p>达到 2 GB 时提醒，不自动删除原图。</p></div></div><div className="storage-bar"><i style={{width:"6%"}}/></div><div className="storage-legend"><span>结构化数据 <b>演示模式</b></span><span>附件 <b>0 MB</b></span></div></section><section className="card settings-section"><div className="settings-title"><KeyRound/><div><h2>数据导出与备份</h2><p>JSON 导出当前可用且未加密；Argon2id 加密备份等待桌面编译环境。</p></div></div><button className="button secondary" onClick={exportJson}><Download size={16}/> 导出 JSON（未加密）</button></section><section className="card settings-section"><div className="settings-title"><Shield/><div><h2>外部助手</h2><p>MCP 默认关闭；启用后也只有摘要读取权限。</p></div></div><span className="status-pill neutral">尚未启用</span></section></div><section className="danger-zone card"><div><h3>重置本地演示数据</h3><p>清除当前浏览器或 SQLite 中的应用状态，并恢复标准菜谱和初始库存。</p></div><button className="button danger" onClick={() => { if (confirm("确定重置演示数据？")) resetDemo(); }}><RotateCcw size={16}/> 重置</button></section></div>;
}
