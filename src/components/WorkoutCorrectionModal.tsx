import { useState } from "react";
import { Modal } from "./Modal";
import { useConfirmedAction } from "./useConfirmedAction";
import { useAppStore } from "../store/appStore";
import {
  WORKOUT_HEART_MAX,
  WORKOUT_HEART_MIN,
  WORKOUT_REASON_LIMIT,
  validateWorkoutDraft,
} from "../domain/workouts";
import { diaryToday } from "../domain/diary";
import type { WorkoutSession } from "../domain/types";

const fieldFor = (workout: WorkoutSession) => ({
  date: workout.date,
  name: workout.name,
  type: workout.type,
  durationMinutes: String(workout.durationMinutes),
  caloriesKcal: workout.caloriesKcal === undefined ? "" : String(workout.caloriesKcal),
  load: workout.load === undefined ? "" : String(workout.load),
  averageHeartRate: workout.averageHeartRate === undefined ? "" : String(workout.averageHeartRate),
  maxHeartRate: workout.maxHeartRate === undefined ? "" : String(workout.maxHeartRate),
});

/** 空串按「没填」处理，不要变成 0。 */
function optionalNumber(raw: string) {
  const text = raw.trim();
  if (!text) return undefined;
  const value = Number(text);
  return Number.isFinite(value) ? value : undefined;
}

export function WorkoutCorrectionModal({
  workout,
  mode = "edit",
  onClose,
}: {
  workout: WorkoutSession;
  mode?: "edit" | "void";
  onClose: () => void;
}) {
  const action = useConfirmedAction();
  const reviseWorkout = useAppStore((state) => state.reviseWorkout);
  const voidWorkout = useAppStore((state) => state.voidWorkout);
  const [voided, setVoided] = useState(mode === "void");
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const initial = fieldFor(workout);
  const [date, setDate] = useState(initial.date);
  const [name, setName] = useState(initial.name);
  const [type, setType] = useState(initial.type);
  const [duration, setDuration] = useState(initial.durationMinutes);
  const [calories, setCalories] = useState(initial.caloriesKcal);
  const [load, setLoad] = useState(initial.load);
  const [averageHeartRate, setAverageHeartRate] = useState(initial.averageHeartRate);
  const [maxHeartRate, setMaxHeartRate] = useState(initial.maxHeartRate);

  const draft = {
    date,
    name,
    type,
    durationMinutes: Number(duration),
    caloriesKcal: optionalNumber(calories),
    load: optionalNumber(load),
    averageHeartRate: optionalNumber(averageHeartRate),
    maxHeartRate: optionalNumber(maxHeartRate),
  };
  const parsed = validateWorkoutDraft(draft);
  const parsedError = duration.trim() ? parsed.error : undefined;

  const diffRows: { label: string; from: string; to: string }[] = [];
  if (!voided) {
    diffRows.push({ label: "运动日期", from: workout.date, to: date });
    diffRows.push({ label: "课程名称", from: workout.name, to: name.trim() || "—" });
    diffRows.push({ label: "运动类型", from: workout.type, to: type.trim() || "—" });
    diffRows.push({
      label: "时长",
      from: `${workout.durationMinutes} 分钟`,
      to: Number.isFinite(draft.durationMinutes) ? `${draft.durationMinutes} 分钟` : "—",
    });
    diffRows.push({
      label: "运动消耗",
      from: workout.caloriesKcal === undefined ? "未填" : `${workout.caloriesKcal} kcal`,
      to: draft.caloriesKcal === undefined ? "未填" : `${draft.caloriesKcal} kcal`,
    });
    diffRows.push({
      label: "平均心率",
      from: workout.averageHeartRate === undefined ? "未填" : `${workout.averageHeartRate} 次/分`,
      to: draft.averageHeartRate === undefined ? "未填" : `${draft.averageHeartRate} 次/分`,
    });
  }

  return (
    <Modal title={voided ? "作废运动记录" : "更正运动记录"} onClose={() => { if (!action.busy) onClose(); }}>
      <form
        className="form"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!voided && parsed.error) return;
          const trimmedReason = reason.trim();
          const result = voided
            ? await action.run(JSON.stringify({ voided, id: workout.id, trimmedReason }), (id) =>
                voidWorkout({ workoutId: workout.id, reason: trimmedReason }, id),
              )
            : await action.run(JSON.stringify({ voided, id: workout.id, trimmedReason, draft }), (id) =>
                reviseWorkout({ workoutId: workout.id, ...draft, reason: trimmedReason }, id),
              );
          if (!result.error) onClose();
        }}
      >
        <fieldset className="library-fields" disabled={action.busy}>
          <div className="ratio-summary">
            <div>
              <strong>{workout.durationMinutes} 分钟</strong>
              <span>
                原记录：{workout.date} · {workout.name} · {workout.type}
              </span>
            </div>
          </div>
          <p className="form-hint">
            更正会保留旧值（标为「已更正」）并新增一条记录；作废只把这条移出统计，两者都要留下原因。运动消耗始终不抵扣饮食额度。
          </p>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={voided}
              onChange={(event) => { setVoided(event.target.checked); setConfirmed(false); }}
            />
            <span>作废这次运动（不计入时长、次数与趋势，不可一键恢复）</span>
          </label>
          {voided && (
            <p className="library-notice">
              作废不会删除这一行：日期、时长与原因仍可在历史里查到，只是不再参与统计。
            </p>
          )}
          {!voided && (
            <dl className="correction-diff">
              {diffRows.map((row) => (
                <div key={row.label} className={row.from !== row.to ? "changed" : ""}>
                  <dt>{row.label}</dt>
                  <dd>
                    <s>{row.from}</s> → <b>{row.to}</b>
                  </dd>
                </div>
              ))}
            </dl>
          )}
          {!voided && (
            <>
              <div className="form-grid">
                <label>
                  <span>运动日期</span>
                  <input type="date" required max={diaryToday()} value={date} onChange={(event) => setDate(event.target.value)} />
                </label>
                <label>
                  <span>运动类型</span>
                  <input value={type} onChange={(event) => setType(event.target.value)} />
                </label>
              </div>
              <label>
                <span>课程或训练名称</span>
                <input required value={name} onChange={(event) => setName(event.target.value)} />
              </label>
              <div className="form-grid">
                <label>
                  <span>时长（分钟）</span>
                  <input
                    required
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={1440}
                    step="1"
                    value={duration}
                    onChange={(event) => setDuration(event.target.value)}
                  />
                </label>
                <label>
                  <span>热量（可选）</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    value={calories}
                    onChange={(event) => setCalories(event.target.value)}
                  />
                </label>
              </div>
              <div className="form-grid">
                <label>
                  <span>运动负荷（可选）</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    value={load}
                    onChange={(event) => setLoad(event.target.value)}
                  />
                </label>
                <label>
                  <span>平均心率（可选）</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={WORKOUT_HEART_MIN}
                    max={WORKOUT_HEART_MAX}
                    value={averageHeartRate}
                    onChange={(event) => setAverageHeartRate(event.target.value)}
                  />
                </label>
              </div>
              <label>
                <span>最高心率（可选）</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={WORKOUT_HEART_MIN}
                  max={WORKOUT_HEART_MAX}
                  value={maxHeartRate}
                  onChange={(event) => setMaxHeartRate(event.target.value)}
                />
              </label>
              {parsedError && <p className="form-error" role="alert">{parsedError}</p>}
            </>
          )}
          <label>
            <span>修改／作废原因</span>
            <textarea
              required
              maxLength={WORKOUT_REASON_LIMIT}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="例如 把两节课记成了一节"
            />
          </label>
          <label className="checkbox-label">
            <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
            <span>我已核对修改内容及其对运动统计的影响</span>
          </label>
          {action.message && <p className="form-error" role="alert">{action.message}</p>}
          <button
            className={`button ${voided ? "danger" : "primary"} wide`}
            disabled={action.busy || !confirmed || !reason.trim() || (!voided && !!parsed.error)}
          >
            {action.busy ? "正在保存…" : voided ? "确认作废并保留原记录" : "确认更正并保留旧版本"}
          </button>
        </fieldset>
      </form>
    </Modal>
  );
}
