import { format } from "date-fns";
import { Activity, Clock3, Dumbbell, Flame, HeartPulse, Plus } from "lucide-react";
import { useState } from "react";
import { Modal } from "../components/Modal";
import { PageHeader } from "../components/PageHeader";
import { useAppStore } from "../store/appStore";
import type { WorkoutSession } from "../domain/types";
import { useConfirmedAction } from "../components/useConfirmedAction";
import type { ActionResult } from "../store/appStore";

export function WorkoutPage() {
  const [open, setOpen] = useState(false);
  const workouts = useAppStore((state) => state.workouts);
  const addWorkout = useAppStore((state) => state.addWorkout);
  const totalMinutes = workouts.reduce((sum, item) => sum + item.durationMinutes, 0);
  const totalCalories = workouts.reduce((sum, item) => sum + (item.caloriesKcal ?? 0), 0);
  const avgHeartRate = workouts.filter((item) => item.averageHeartRate).length
    ? workouts.reduce((sum, item) => sum + (item.averageHeartRate ?? 0), 0) / workouts.filter((item) => item.averageHeartRate).length
    : 0;
  return <div className="page">
    <PageHeader eyebrow="消耗独立展示" title="运动记录" description="运动热量不会自动增加饮食额度；Keep 多图使用指纹和核心字段避免重复导入。" action={<button className="button primary" onClick={() => setOpen(true)}><Plus size={17}/> 记录运动</button>}/>
    <div className="metric-row"><Metric icon={<Clock3/>} label="累计时长" value={`${totalMinutes} 分钟`}/><Metric icon={<Flame/>} label="运动消耗" value={`${Math.round(totalCalories)} kcal`}/><Metric icon={<HeartPulse/>} label="平均心率" value={avgHeartRate ? `${Math.round(avgHeartRate)} 次/分` : "暂无"}/><Metric icon={<Activity/>} label="训练次数" value={`${workouts.length} 次`}/></div>
    <section className="card workout-list"><div className="card-heading compact"><div><p className="eyebrow">训练历史</p><h2>已确认运动</h2></div></div>{workouts.length ? workouts.slice().reverse().map((item) => <article className="workout-row" key={item.id}><div className="workout-icon"><Dumbbell/></div><div><strong>{item.name}</strong><span>{item.date} · {item.type}</span></div><div><b>{item.durationMinutes}</b><span>分钟</span></div><div><b>{item.caloriesKcal ?? "—"}</b><span>千卡</span></div><div><b>{item.averageHeartRate ?? "—"}</b><span>平均心率</span></div></article>) : <div className="large-empty"><Dumbbell/><h3>尚未记录运动</h3><p>可先手工录入；Keep 截图会从收件箱生成待确认草稿。</p><button className="button secondary" onClick={() => setOpen(true)}>添加第一条记录</button></div>}</section>
    {open && <WorkoutModal onClose={() => setOpen(false)} onSave={addWorkout}/>}
  </div>;
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) { return <article className="metric-card icon-metric"><span className="metric-icon">{icon}</span><div><span>{label}</span><strong>{value}</strong></div></article>; }

type WorkoutInput = Omit<WorkoutSession, "id" | "createdAt">;

function WorkoutModal({ onClose, onSave }: { onClose: () => void; onSave: (input: WorkoutInput, commandId?: string) => Promise<ActionResult> }) {
  const [form, setForm] = useState({ date: format(new Date(), "yyyy-MM-dd"), name: "", type: "低冲击有氧", durationMinutes: "", caloriesKcal: "", load: "", averageHeartRate: "", maxHeartRate: "" });
  const action = useConfirmedAction();
  return <Modal title="记录一次运动" onClose={() => { if (!action.busy) onClose(); }}><form className="form" onSubmit={async (event) => { event.preventDefault(); const input = { date: form.date, name: form.name, type: form.type, durationMinutes: Number(form.durationMinutes), caloriesKcal: form.caloriesKcal ? Number(form.caloriesKcal) : undefined, load: form.load ? Number(form.load) : undefined, averageHeartRate: form.averageHeartRate ? Number(form.averageHeartRate) : undefined, maxHeartRate: form.maxHeartRate ? Number(form.maxHeartRate) : undefined }; const result = await action.run(JSON.stringify(input), (id) => onSave(input, id)); if (!result.error) { onClose(); } }}>
    <div className="form-grid"><label><span>日期</span><input type="date" value={form.date} onChange={(event) => setForm({...form,date:event.target.value})}/></label><label><span>运动类型</span><input value={form.type} onChange={(event) => setForm({...form,type:event.target.value})}/></label></div>
    <label><span>课程或训练名称</span><input required value={form.name} onChange={(event) => setForm({...form,name:event.target.value})} placeholder="例如 低冲击有氧"/></label>
    <div className="form-grid"><label><span>时长（分钟）</span><input required type="number" min="1" value={form.durationMinutes} onChange={(event) => setForm({...form,durationMinutes:event.target.value})}/></label><label><span>热量（可选）</span><input type="number" min="0" value={form.caloriesKcal} onChange={(event) => setForm({...form,caloriesKcal:event.target.value})}/></label></div>
    <div className="form-grid"><label><span>运动负荷（可选）</span><input type="number" min="0" value={form.load} onChange={(event) => setForm({...form,load:event.target.value})}/></label><label><span>平均心率（可选）</span><input type="number" min="0" value={form.averageHeartRate} onChange={(event) => setForm({...form,averageHeartRate:event.target.value})}/></label></div>
    <label><span>最高心率（可选）</span><input type="number" min="0" value={form.maxHeartRate} onChange={(event) => setForm({...form,maxHeartRate:event.target.value})}/></label>
    <p className="form-hint">这些数值只用于展示训练趋势，不会自动换算成可多吃的热量。</p>{action.message && <p className="form-error" role="alert">{action.message}</p>}<button className="button primary wide" type="submit" disabled={action.busy}>{action.busy ? "正在保存…" : "确认运动记录"}</button>
  </form></Modal>;
}
