import { useState } from "react";
import { Modal } from "./Modal";
import { useConfirmedAction } from "./useConfirmedAction";
import { useAppStore } from "../store/appStore";
import { ratioPercent } from "../domain/diary";
import type { PreparedBatch, WasteEvent } from "../domain/types";

export function BatchCorrectionModal({ batch, waste, onClose }: { batch: PreparedBatch; waste?: WasteEvent; onClose: () => void }) {
  const action = useConfirmedAction();
  const correct = useAppStore(s => s.correctBatch);
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [voided, setVoided] = useState(false);
  const [ratio, setRatio] = useState(String(ratioPercent(waste?.ratio ?? 0)));
  const kind = !waste ? "void_prepared_batch" : voided ? "void_waste" : "revise_waste";
  return <Modal title={waste ? "更正熟食浪费记录" : "冲正误确认的制作"} onClose={() => { if (!action.busy) onClose(); }}>
    <form className="form" onSubmit={async e => {
      e.preventDefault();
      if (!confirmed || !reason.trim()) return;
      const input = { reason, ...(waste ? { wasteId: waste.id, ...(!voided ? { ratio: Number(ratio) / 100 } : {}) } : { batchId: batch.id }) };
      const result = await action.run(JSON.stringify({ kind, input }), id => correct(kind, input, id));
      if (!result.error) onClose();
    }}><fieldset className="library-fields" disabled={action.busy}>
      <p className="form-hint">制作日 {batch.date} · 批次 {batch.id}</p>
      {waste ? <>
        <p className="library-notice">原浪费记录：{waste.date} · 整锅的 {ratioPercent(waste.ratio)}%。只更正误填的账目，不退回生鲜、不改变已经吃掉的部分。释放的余量不代表熟食仍可安全食用，请检查实际剩余。</p>
        <label className="checkbox-label"><input type="checkbox" checked={voided} onChange={e => { setVoided(e.target.checked); setConfirmed(false); }} /><span>作废这条误填的浪费记录（保留原始证据）</span></label>
        {!voided && <label><span>正确浪费比例（占整锅 %）</span><input required type="number" min="0.01" step="0.01" max={ratioPercent(waste.ratio + batch.remainingRatio)} value={ratio} onChange={e => { setRatio(e.target.value); setConfirmed(false); }} /></label>}
        <p className="form-hint">原日期和丢弃类别保持不变；若实际已经丢弃，不应为增加可用余量而作废。</p>
      </> : <p className="library-notice">仅用于实际没有制作、却误点确认的情况。系统核对原料扣减前后快照；只要已有分餐／浪费历史，或原库存发生后续制作、退货、损耗、盘点，便拒绝一键冲正。实际做过的菜不能当作生鲜退回；旧批次缺少快照时请人工盘点。原扣减流水保留，追加反向流水。</p>}
      <label><span>纠错原因</span><textarea required maxLength={500} value={reason} onChange={e => { setReason(e.target.value); setConfirmed(false); }} /></label>
      <label className="checkbox-label"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} /><span>{waste ? "已核对实际浪费和熟食余量，不占用已进食部分" : "实际没有制作，已核对这次冲正不是退回已经烹饪的食物"}</span></label>
      {action.message && <p className="form-error" role="alert">{action.message}</p>}
      <button className="button danger wide" disabled={action.busy || !confirmed || !reason.trim()}>{action.busy ? "正在核对并保存…" : waste ? "确认更正浪费记录" : "确认冲正误制作（需通过安全核对）"}</button>
    </fieldset></form>
  </Modal>;
}
