import { useState } from "react";
import { useAppStore } from "../store/appStore";
import { ratioPercent } from "../domain/diary";
import { BatchCorrectionModal } from "./BatchCorrectionModal";
import type { PreparedBatch, WasteEvent } from "../domain/types";

const mealLabels = { breakfast: "早餐", lunch: "午餐", dinner: "晚餐", snack: "加餐" };
export function BatchHistory({ date }: { date: string }) {
  const state = useAppStore();
  const [correction, setCorrection] = useState<{ batch: PreparedBatch; waste?: WasteEvent } | null>(null);
  // Include batches made on this day OR whose waste was logged on this day.
  const batches = state.batches.filter(b => b.date === date || state.wasteEvents.some(w => w.batchId === b.id && w.date === date));
  if (!batches.length) return null;
  return <section className="card batch-history"><div className="card-heading compact"><div><p className="eyebrow">原料、进食、浪费分账</p><h2>制作与浪费记录</h2></div><span className="status-pill neutral">{batches.length} 批（含历史）</span></div>
    {batches.map(batch => {
      const consumed = state.consumptionEvents.filter(e => e.batchId === batch.id && (!e.status || e.status === "active"));
      const waste = state.wasteEvents.filter(e => e.batchId === batch.id);
      const hasEvents = state.consumptionEvents.some(e => e.batchId === batch.id) || waste.length > 0 || state.meals.some(m => m.preparedBatchId === batch.id);
      return <article className="batch-ledger" key={batch.id}>
        <div className="batch-history-row"><div><strong>{state.recipes.find(r => r.id === batch.recipeVersionId)?.name ?? "菜谱版本缺失"}</strong><span>制作于 {batch.date} · {consumed.length ? consumed.map(e => `${e.date} ${mealLabels[e.mealType]} ${ratioPercent(e.ratio)}%`).join(" · ") : "无有效进食"}</span></div>
          {batch.status === "void" ? <p>误制作已冲正；原比例与扣减证据仅供追溯，不可继续分餐。</p> : <><div><small>已吃</small><b>{ratioPercent(batch.consumedRatio)}%</b></div><div><small>待核对余量</small><b>{ratioPercent(batch.remainingRatio)}%</b></div><div><small>有效浪费</small><b>{ratioPercent(batch.wastedRatio)}%</b></div></>}
          <span className={`status-pill ${batch.status === "open" ? "warning" : "neutral"}`}>{batch.status === "void" ? "已冲正" : batch.status === "open" ? "仍有余量" : "已结束"}</span>
        </div>
        {batch.status === "void" ? <p className="form-hint">原因：{batch.correctionReason}</p> : !hasEvents && <div className="button-row"><button className="text-button" onClick={() => setCorrection({ batch })}>误点制作？核对并冲正</button><small>仅没有实际制作且无后续操作时可用</small></div>}
        {waste.map(w => <div className="waste-ledger-row" key={w.id}><div><strong>{w.date} · 整锅 {ratioPercent(w.ratio)}%</strong><span>{w.status === "superseded" ? "已修订（原记录不计入）" : w.status === "void" ? "已作废（不计入）" : "有效熟食浪费"}{w.correctionReason ? ` · 原因：${w.correctionReason}` : ""}</span></div>{batch.status !== "void" && (!w.status || w.status === "active") && <button className="text-button" onClick={() => setCorrection({ batch, waste: w })}>更正浪费</button>}</div>)}
      </article>;
    })}
    {correction && <BatchCorrectionModal batch={correction.batch} waste={correction.waste} onClose={() => setCorrection(null)} />}
  </section>;
}
