import { useState } from "react";
import { Modal } from "./Modal";
import { useConfirmedAction } from "./useConfirmedAction";
import { useAppStore } from "../store/appStore";
import { WORKOUT_REASON_LIMIT } from "../domain/workouts";
import type { WorkoutSession } from "../domain/types";

/**
 * 撤销更正 / 恢复作废的确认框。
 *
 * 与「编辑 / 作废」分开：那两个要改字段、要看清前后差异，这里只是把一次操作退回去，
 * 混在同一个弹窗里会让两套状态互相污染。
 *
 * 原因的口径刻意不对称：撤销本身自解释，可留空；恢复会让一条作废记录重新进入统计，
 * 必须写明为什么。
 */
export function WorkoutRevertModal({
  workout,
  mode,
  parent,
  onClose,
}: {
  workout: WorkoutSession;
  mode: "undo" | "restore";
  parent?: WorkoutSession;
  onClose: () => void;
}) {
  const action = useConfirmedAction();
  const undoWorkoutCorrection = useAppStore((state) => state.undoWorkoutCorrection);
  const restoreVoidedWorkout = useAppStore((state) => state.restoreVoidedWorkout);
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const undoing = mode === "undo";
  const blocked = action.busy || !confirmed || (!undoing && !reason.trim());

  return (
    <Modal
      title={undoing ? "撤销上一次更正" : "恢复已作废的记录"}
      onClose={() => {
        if (!action.busy) onClose();
      }}
    >
      <form
        className="form"
        onSubmit={async (event) => {
          event.preventDefault();
          if (blocked) return;
          const trimmedReason = reason.trim();
          const result = undoing
            ? await action.run(JSON.stringify({ mode, id: workout.id, trimmedReason }), (id) =>
                undoWorkoutCorrection({ workoutId: workout.id, reason: trimmedReason }, id),
              )
            : await action.run(JSON.stringify({ mode, id: workout.id, trimmedReason }), (id) =>
                restoreVoidedWorkout({ workoutId: workout.id, reason: trimmedReason }, id),
              );
          if (!result.error) onClose();
        }}
      >
        <fieldset className="library-fields" disabled={action.busy}>
          <div className="ratio-summary">
            <div>
              <strong>{workout.durationMinutes} 分钟</strong>
              <span>
                当前记录：{workout.date} · {workout.name} · {workout.type}
              </span>
            </div>
            {undoing && parent && (
              <div>
                <strong>{parent.durationMinutes} 分钟</strong>
                <span>
                  恢复为：{parent.date} · {parent.name} · {parent.type}
                </span>
              </div>
            )}
          </div>
          <p className="form-hint">
            {undoing
              ? "不会删除任何一行。这次更正会标为「已撤销更正」，原记录重新参与统计；如果改过日期，那两天的统计都会变回去。"
              : `这条记录会重新计入 ${workout.date} 的时长、次数与趋势统计；作废时写的原因仍留在记录里。`}
          </p>
          <label>
            <span>{undoing ? "撤销原因（可留空）" : "恢复原因"}</span>
            <textarea
              required={!undoing}
              maxLength={WORKOUT_REASON_LIMIT}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder={undoing ? "例如 刚才改错了" : "例如 误点作废"}
            />
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            <span>我已核对这次操作对统计的影响</span>
          </label>
          {action.message && (
            <p className="form-error" role="alert">
              {action.message}
            </p>
          )}
          <button className={`button ${undoing ? "secondary" : "primary"} wide`} disabled={blocked}>
            {action.busy ? "正在保存…" : undoing ? "确认撤销更正" : "确认恢复记录"}
          </button>
        </fieldset>
      </form>
    </Modal>
  );
}
