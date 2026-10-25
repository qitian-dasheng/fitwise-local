import { diaryToday, shiftDiaryDate, type DiaryDateProps } from "../domain/diary";
import { Activity, ChevronLeft, ChevronRight, Clock3, Dumbbell, Flame, HeartPulse, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { Modal } from "../components/Modal";
import { useAppStore } from "../store/appStore";
import type { WorkoutSession } from "../domain/types";
import { useConfirmedAction } from "../components/useConfirmedAction";
import type { ActionResult } from "../store/appStore";
import { WorkoutCorrectionModal } from "../components/WorkoutCorrectionModal";
import { WorkoutRevertModal } from "../components/WorkoutRevertModal";
import {
  canRestoreVoid,
  canUndoCorrection,
  correctionParent,
  draftFromWorkout,
  isActiveWorkout,
  isInactiveLabel,
  latestActiveWorkout,
  undoHeadFor,
} from "../domain/workouts";
import { useEnergyUnit } from "../hooks/useEnergyUnit";
import { energyUnitLabels, toDisplayEnergy, toDisplayEnergyMaybe } from "../domain/energyDisplay";

export function WorkoutPage({ date = diaryToday(), onDateChange, autoOpen, onAutoOpenConsumed }: DiaryDateProps & { autoOpen?: boolean; onAutoOpenConsumed?: () => void } = {}) {
  const [open, setOpen] = useState(false);
  const [energyUnit] = useEnergyUnit();
  // 今日页「练了什么」直达：打开记录表单后立刻回报。
  useEffect(() => {
    if (!autoOpen) return;
    setOpen(true);
    onAutoOpenConsumed?.();
  }, [autoOpen, onAutoOpenConsumed]);
  const [correction, setCorrection] = useState<{ workout: WorkoutSession; mode: "edit" | "void" } | null>(null);
  const [revert, setRevert] = useState<{ workout: WorkoutSession; mode: "undo" | "restore" } | null>(null);
  const allWorkouts = useAppStore((state) => state.workouts);
  const dayWorkouts = allWorkouts.filter((item) => item.date === date);
  const workouts = dayWorkouts.filter(isActiveWorkout);
  const addWorkout = useAppStore((state) => state.addWorkout);
  const suggestion = latestActiveWorkout(allWorkouts, date);
  const totalMinutes = workouts.reduce((sum, item) => sum + item.durationMinutes, 0);
  const totalCalories = workouts.reduce((sum, item) => sum + (item.caloriesKcal ?? 0), 0);
  const heartWorkouts = workouts.filter((item) => item.averageHeartRate != null);
  const heartMinutes = heartWorkouts.reduce((sum, item) => sum + item.durationMinutes, 0);
  const avgHeartRate = heartMinutes ? heartWorkouts.reduce((sum, item) => sum + item.averageHeartRate! * item.durationMinutes, 0) / heartMinutes : 0;
  const calorieCount = workouts.filter((item) => item.caloriesKcal != null).length;
  const inactiveCount = dayWorkouts.length - workouts.length;
  return <div className="page" style={{ display: "flex", flexDirection: "column", gap: 13, flex: 1, minHeight: 0 }}>
    <header className="ui-page-head">
      <div>
        <div className="date">消耗独立展示 · 运动热量不会增加饮食额度</div>
        <h1>运动记录</h1>
      </div>
      <div className="actions" style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <div className="ui-datestrip">
          <button className="ui-navbtn" aria-label="前一天" onClick={() => onDateChange?.(shiftDiaryDate(date, -1))}><ChevronLeft size={15} /></button>
          <input type="date" aria-label="查看日期" value={date} onChange={(event) => event.target.value && onDateChange?.(event.target.value)} style={{ all: "unset", cursor: "pointer", font: "inherit", color: "var(--ui-ink-2)" }} />
          <button className="ui-navbtn" aria-label="后一天" disabled={date >= diaryToday()} onClick={() => onDateChange?.(shiftDiaryDate(date, 1))}><ChevronRight size={15} /></button>
        </div>
        <button className="ui-btn primary" onClick={() => setOpen(true)}><Plus size={15}/> 记录运动</button>
      </div>
    </header>
    <p className="ui-chart-foot" style={{ marginTop: 0, paddingTop: 0 }}>仅统计 {date} 的有效记录：热量已知 {calorieCount}/{workouts.length} 次；平均心率按已知记录时长加权，不是逐秒测量。{inactiveCount > 0 ? `另有 ${inactiveCount} 条已更正或作废，不计入统计。` : ""}</p>
    <div className="metric-row"><Metric icon={<Clock3/>} label="所选日时长" value={`${totalMinutes} 分钟`}/><Metric icon={<Flame/>} label="运动消耗" value={calorieCount ? `${Math.round(toDisplayEnergy(totalCalories, energyUnit))} ${energyUnitLabels[energyUnit]}${calorieCount < workouts.length ? "（部分已知）" : ""}` : "未知"}/><Metric icon={<HeartPulse/>} label="时长加权心率" value={avgHeartRate ? `${Math.round(avgHeartRate)} 次/分` : "暂无"}/><Metric icon={<Activity/>} label="训练次数" value={`${workouts.length} 次`}/></div>
    <section className="ui-card workout-list"><div className="ui-panel-head"><h2>本日记录</h2><span>含更正与作废，可回查</span></div>    {dayWorkouts.length ? dayWorkouts.slice().reverse().map((item) => {
      const active = isActiveWorkout(item);
      // 旧行也给撤销入口：更正时改过日期的话，新行会跑到另一天去。
      const undoHead = active ? null : undoHeadFor(item, allWorkouts);
      return <article className={`workout-row${active ? "" : " workout-row-inactive"}`} key={item.id}>
        <div className="workout-icon"><Dumbbell/></div>
        <div><strong>{item.name}</strong><span>{item.date} · {item.type}</span></div>
        <div><b>{item.durationMinutes}</b><span>分钟</span></div>
        <div><b>{toDisplayEnergyMaybe(item.caloriesKcal, energyUnit) ?? "—"}</b><span>{energyUnitLabels[energyUnit]}</span></div>
        <div><b>{item.averageHeartRate ?? "—"}</b><span>平均心率</span></div>
        <div className="workout-actions">
          {active ? <>
            <button className="text-button" onClick={() => setCorrection({ workout: item, mode: "edit" })}>编辑</button>
            <button className="text-button danger-text" onClick={() => setCorrection({ workout: item, mode: "void" })}>作废</button>
            {canUndoCorrection(item, allWorkouts) && <button className="text-button" onClick={() => setRevert({ workout: item, mode: "undo" })}>撤销更正</button>}
          </> : <>
            <span className="workout-inactive-note">{isInactiveLabel(item)}{item.correctionReason ? ` · ${item.correctionReason}` : ""}</span>
            {canRestoreVoid(item, allWorkouts) && <button className="text-button" onClick={() => setRevert({ workout: item, mode: "restore" })}>恢复</button>}
            {undoHead && <button className="text-button" onClick={() => setRevert({ workout: undoHead, mode: "undo" })}>撤销更正</button>}
          </>}
        </div>
      </article>;
    }) : <div className="large-empty"><Dumbbell/><h3>尚未记录运动</h3><p>可先手工录入；Keep 截图目前只能保存在收件箱，暂不会自动生成运动草稿。</p><button className="button secondary" onClick={() => setOpen(true)}>添加第一条记录</button></div>}</section>
    {open && <WorkoutModal initialDate={date} suggestion={suggestion} onRecorded={onDateChange} onClose={() => setOpen(false)} onSave={addWorkout}/>}
    {correction && <WorkoutCorrectionModal workout={correction.workout} mode={correction.mode} onClose={() => setCorrection(null)}/>}
    {revert && <WorkoutRevertModal workout={revert.workout} mode={revert.mode} parent={correctionParent(revert.workout, allWorkouts) ?? undefined} onClose={() => setRevert(null)}/>}
  </div>;
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) { return <article className="metric-card icon-metric"><span className="metric-icon">{icon}</span><div><span>{label}</span><strong>{value}</strong></div></article>; }

type WorkoutInput = Omit<WorkoutSession, "id" | "createdAt">;

function WorkoutModal({ onClose, onSave, initialDate, onRecorded, suggestion }: { initialDate: string; suggestion?: WorkoutSession | null; onRecorded?: (date: string) => void; onClose: () => void; onSave: (input: WorkoutInput, commandId?: string) => Promise<ActionResult> }) {
  const [form, setForm] = useState({ date: initialDate, name: "", type: "低冲击有氧", durationMinutes: "", caloriesKcal: "", load: "", averageHeartRate: "", maxHeartRate: "" });
  const [filled, setFilled] = useState(false);
  const action = useConfirmedAction();
  // 只在名字还空着时提示，用户开始打字后自动让位，不覆盖已输入内容。
  const canSuggest = Boolean(suggestion) && !form.name.trim();
  function fillFromPrevious() {
    if (!suggestion) return;
    const draft = draftFromWorkout(suggestion, form.date);
    setForm({
      ...form,
      name: draft.name,
      type: draft.type,
      durationMinutes: String(draft.durationMinutes),
      caloriesKcal: draft.caloriesKcal === undefined ? "" : String(draft.caloriesKcal),
      load: draft.load === undefined ? "" : String(draft.load),
      averageHeartRate: draft.averageHeartRate === undefined ? "" : String(draft.averageHeartRate),
      maxHeartRate: draft.maxHeartRate === undefined ? "" : String(draft.maxHeartRate),
    });
    setFilled(true);
  }
  return <Modal title="记录一次运动" onClose={() => { if (!action.busy) onClose(); }}><form className="form" onSubmit={async (event) => { event.preventDefault(); const input = { date: form.date, name: form.name, type: form.type, durationMinutes: Number(form.durationMinutes), caloriesKcal: form.caloriesKcal ? Number(form.caloriesKcal) : undefined, load: form.load ? Number(form.load) : undefined, averageHeartRate: form.averageHeartRate ? Number(form.averageHeartRate) : undefined, maxHeartRate: form.maxHeartRate ? Number(form.maxHeartRate) : undefined }; const result = await action.run(JSON.stringify(input), (id) => onSave(input, id)); if (!result.error) { onRecorded?.(form.date); onClose(); } }}>
    <fieldset className="library-fields" disabled={action.busy}>
    {canSuggest && suggestion && <button type="button" className="button secondary wide" onClick={fillFromPrevious}>填入上次训练 · {suggestion.date.slice(5)} {suggestion.name} · {suggestion.durationMinutes} 分钟</button>}
    {filled && !canSuggest && suggestion && <p className="form-hint">已填入 {suggestion.date.slice(5)} 的记录，可直接修改后保存。</p>}
    <div className="form-grid"><label><span>日期</span><input type="date" required max={diaryToday()} value={form.date} onChange={(event) => setForm({...form,date:event.target.value})}/></label><label><span>运动类型</span><input value={form.type} onChange={(event) => setForm({...form,type:event.target.value})}/></label></div>
    <label><span>课程或训练名称</span><input required value={form.name} onChange={(event) => setForm({...form,name:event.target.value})} placeholder="例如 低冲击有氧"/></label>
    <div className="form-grid"><label><span>时长（分钟）</span><input required type="number" min="1" value={form.durationMinutes} onChange={(event) => setForm({...form,durationMinutes:event.target.value})}/></label><label><span>热量（可选）</span><input type="number" min="0" value={form.caloriesKcal} onChange={(event) => setForm({...form,caloriesKcal:event.target.value})}/></label></div>
    <div className="form-grid"><label><span>运动负荷（可选）</span><input type="number" min="0" value={form.load} onChange={(event) => setForm({...form,load:event.target.value})}/></label><label><span>平均心率（可选）</span><input type="number" min="0" value={form.averageHeartRate} onChange={(event) => setForm({...form,averageHeartRate:event.target.value})}/></label></div>
    <label><span>最高心率（可选）</span><input type="number" min="0" value={form.maxHeartRate} onChange={(event) => setForm({...form,maxHeartRate:event.target.value})}/></label>
    <p className="form-hint">这些数值只用于展示训练趋势，不会自动换算成可多吃的热量。</p>{action.message && <p className="form-error" role="alert">{action.message}</p>}<button className="button primary wide" type="submit" disabled={action.busy}>{action.busy ? "正在保存…" : "确认运动记录"}</button>
    </fieldset>
  </form></Modal>;
}
