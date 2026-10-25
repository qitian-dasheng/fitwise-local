import { PencilLine } from "lucide-react";
import { useState } from "react";
import { Modal } from "./Modal";
import { useConfirmedAction } from "./useConfirmedAction";
import { validateTargetProfileInput } from "../domain/targets";
import type { TargetProfileInput, UserProfile } from "../domain/types";
import { useAppStore } from "../store/appStore";

/**
 * 个人目标弹窗（0.9.4 第六轮抽出共享）：设置页「个人目标」行与今日页预算卡的
 * 「目标」按钮共用同一组件。修改只影响当前显示与之后的判定；旧值保留在审计链里。
 */
export function TargetGoalModal({ profile, onClose }: { profile: UserProfile; onClose: () => void }) {
  const setTargetProfile = useAppStore((state) => state.setTargetProfile);
  const targetAction = useConfirmedAction();
  const [targetForm, setTargetForm] = useState<null | { min: string; target: string; max: string; protein: string; fiber: string; weight: string }>(null);

  return (
    <Modal title="个人目标" onClose={() => { setTargetForm(null); targetAction.setMessage(""); onClose(); }}>
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
            })}><PencilLine size={15}/> 编辑目标</button>
          </div>
        </>
      )}
    </Modal>
  );
}
