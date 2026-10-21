import { useState } from "react";
import { Modal } from "./Modal";
import { useConfirmedAction } from "./useConfirmedAction";
import { useAppStore } from "../store/appStore";
import { emptyLabelForm, emptyLabelReview, labelReviewItems, previewLabel, type LabelDraftForm, type LabelDraftRecord } from "../domain/labelDrafts";
import { foodBasisLabels, foodUnitLabels, nutrientLabel } from "../domain/foodLibrary";
import { nutrientKeys, type FoodUnit } from "../domain/types";
import { notifyLabelDrafts, readLabelDraft, useLabelDrafts } from "../data/labelDrafts";
import { useArtifactImage, type InputReceipt } from "../data/artifacts";

const nutrientNames = { calories: "能量", protein: "蛋白质", carbohydrates: "碳水化合物", fat: "脂肪", fiber: "膳食纤维", sugar: "糖", sodium: "钠" };
const statuses = { draft: "待核对", confirmed: "已建档", discarded: "已忽略" };
const units = () => Object.entries(foodUnitLabels).map(([key, value]) => <option key={key} value={key}>{value}</option>);

export function LabelDraftsPanel({ onOpen }: { onOpen: (draft: LabelDraftRecord) => void }) {
  const [status, setStatus] = useState("draft"), [offset, setOffset] = useState(0), [error, setError] = useState(""), [opening, setOpening] = useState(false);
  const list = useLabelDrafts(status, offset);
  return <section className="card label-drafts-panel" aria-label="营养标签草稿">
    <div className="label-section-heading"><div><h2>营养标签草稿</h2><p>本机手工整理，可分次补全。确认后进入食材库，不记餐、不扣库存。</p></div><label>筛选<select value={status} onChange={e => { setStatus(e.target.value); setOffset(0); }}>{Object.entries(statuses).map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select></label></div>
    {(error || list.error) && <p role="alert" className="form-error">{error || list.error}</p>}
    {list.loading ? <p>正在读取草稿…</p> : !list.data.items.length ? <p className="muted">暂无{statuses[status as keyof typeof statuses]}草稿。</p> : list.data.items.map(d => <div className="label-draft-row" key={d.id}><div><strong>{d.name?.trim() || "未命名标签"}</strong><small>{statuses[d.status]} · 草稿修订 {d.revision} · {new Date(d.updatedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}</small></div><button className="button secondary small" disabled={opening} onClick={async () => { setOpening(true); setError(""); try { onOpen(await readLabelDraft(d.id)); } catch (e) { setError(String(e)); } finally { setOpening(false); } }}>{d.status === "draft" ? "继续整理" : "查看来源"}</button></div>)}
    <div className="button-row"><button className="text-button" disabled={offset === 0 || list.loading} onClick={() => setOffset(v => Math.max(0, v - 50))}>上一页</button><small>第 {offset / 50 + 1} 页</small><button className="text-button" disabled={!list.data.hasMore || list.loading} onClick={() => setOffset(v => v + 50)}>下一页</button></div>
  </section>;
}

export function LabelDraftModal({ draft, source, onClose }: { draft?: LabelDraftRecord; source?: InputReceipt; onClose: () => void }) {
  const [form, setForm] = useState<LabelDraftForm>(() => structuredClone(draft?.form ?? { ...emptyLabelForm(), sourceNote: source?.note ?? "" }));
  const [initial] = useState(() => JSON.stringify(form));
  const [saved, setSaved] = useState(() => draft ? JSON.stringify(draft.form) : "");
  const [identity, setIdentity] = useState(() => draft ? { id: draft.id, revision: draft.revision } : null);
  const [status, setStatus] = useState(draft?.status ?? "draft");
  const [review, setReview] = useState(emptyLabelReview), [allowDuplicate, setAllowDuplicate] = useState(false), [message, setMessage] = useState("");
  const [closing, setClosing] = useState(false), [reason, setReason] = useState(""), [showSource, setShowSource] = useState(false);
  const action = useConfirmedAction(), command = useAppStore(s => s.labelDraftCommand);
  const sourceId = draft?.sourceReceiptId ?? source?.id ?? null;
  const artifactId = draft?.sourceArtifactId ?? source?.artifactId ?? null;
  const sourceUnavailable = draft?.sourceUnavailable ?? Boolean(source?.trashedAt || source?.purgedAt);
  const sourceImage = useArtifactImage(artifactId, "preview", "", showSource && !sourceUnavailable);
  const readonly = status !== "draft", dirty = JSON.stringify(form) !== saved;
  let preview: ReturnType<typeof previewLabel> | undefined, previewError = "";
  try { preview = previewLabel(form); } catch (e) { previewError = e instanceof Error ? e.message : String(e); }
  const update = (change: Partial<LabelDraftForm>) => { setForm(f => ({ ...f, ...change })); setReview(emptyLabelReview()); setMessage(""); setAllowDuplicate(false); };
  const close = () => { if (action.busy) return; if (!readonly && dirty && (identity || JSON.stringify(form) !== initial)) setClosing(true); else onClose(); };
  async function save() {
    const payload = { form, ...(identity ? { draftId: identity.id, expectedRevision: identity.revision } : {}), ...(sourceId ? { sourceReceiptId: sourceId } : {}) };
    const result = await action.run(`save:${JSON.stringify(payload)}`, id => command("save_label_draft", payload, id));
    if (!result.error && result.draftId && result.draftRevision) { setIdentity({ id: result.draftId, revision: result.draftRevision }); setSaved(JSON.stringify(form)); setMessage("草稿已保存到本机，可关闭后继续整理。"); setReview(emptyLabelReview()); notifyLabelDrafts(); }
  }
  async function confirm() {
    if (!identity || dirty || !preview || !Object.values(review).every(Boolean)) return;
    const payload = { draftId: identity.id, expectedRevision: identity.revision, review, allowDuplicate };
    const result = await action.run(`confirm:${JSON.stringify(payload)}`, id => command("confirm_label_draft", payload, id));
    if (!result.error) { setStatus("confirmed"); setMessage(`已建立“${form.name}”食材资料。到饮食页添加食物时搜索它，只需填写实际摄入量。未写入饮食或库存。`); notifyLabelDrafts(); }
  }
  return <Modal title={readonly ? "营养标签来源记录" : "手工整理营养标签"} onClose={close}>
    <div className="form label-draft-editor">
      <p className="recipe-summary">离线手工抄录，不是 OCR 或 AI 识别。空白保留未知，明确为零才填 0。</p>
      {(sourceId || artifactId) && <div className="label-source"><strong>来源：{draft?.sourceName ?? source?.name ?? "文字 / 商品链接"}</strong>{sourceUnavailable && artifactId ? <p>来源原件已删除或在回收站，草稿与已确认数据仍保留。</p> : artifactId && <button className="text-button" onClick={() => setShowSource(v => !v)}>{showSource ? "收起来源预览" : "查看本机来源预览"}</button>}{showSource && sourceImage.url && <img className="label-source-preview" src={sourceImage.url} alt="本机来源图片"/>}{sourceImage.error && <p role="alert">{sourceImage.error}</p>}</div>}
      <fieldset disabled={readonly || action.busy} className="label-editor-fields">
        <div className="form-grid"><label>食物名称<input maxLength={120} value={form.name} onChange={e => update({ name: e.target.value })}/></label><label>品牌（可空）<input maxLength={120} value={form.brand} onChange={e => update({ brand: e.target.value })}/></label></div>
        <label>食物状态<select value={form.measurementBasis} onChange={e => update({ measurementBasis: e.target.value as LabelDraftForm["measurementBasis"] })}>{Object.entries(foodBasisLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <div className="form-grid"><label>标签参考数量<input inputMode="decimal" value={form.basisQuantity} onChange={e => update({ basisQuantity: e.target.value })}/></label><label>参考单位<select value={form.basisUnit} onChange={e => update({ basisUnit: e.target.value as FoodUnit })}>{units()}</select></label></div>
        <div className="form-grid"><label>标签能量单位<select value={form.energyUnit} onChange={e => update({ energyUnit: e.target.value as "kcal" | "kJ" })}><option value="kJ">千焦 kJ</option><option value="kcal">千卡 kcal</option></select></label><label>标签钠单位<select value={form.sodiumUnit} onChange={e => update({ sodiumUnit: e.target.value as "g" | "mg" })}><option value="mg">毫克 mg</option><option value="g">克 g</option></select></label></div>
        <div className="form-grid">{nutrientKeys.map(key => <label key={key}>{nutrientNames[key]} {key === "calories" ? form.energyUnit : key === "sodium" ? form.sodiumUnit : "g"}<input inputMode="decimal" maxLength={64} placeholder="未知请留空" value={form.nutrients[key]} onChange={e => update({ nutrients: { ...form.nutrients, [key]: e.target.value } })}/></label>)}</div>
        <details className="recipe-rules" open={form.conversions.length > 0 || undefined}><summary>包装与单位换算（按需填写）</summary><p>例如参考规格为 100 克：1 包装对应 200 克，应填换算数量 1、对应参考数量 200。净含量只作核对，不自动建立换算；克与毫升、生熟不默认互换。</p>
          {form.conversions.map((c, i) => <div className="label-conversion" key={i}><div className="form-grid"><label>换算数量<input inputMode="decimal" value={c.quantity} onChange={e => update({ conversions: form.conversions.map((v, n) => n === i ? { ...v, quantity: e.target.value } : v) })}/></label><label>换算单位<select value={c.unit} onChange={e => update({ conversions: form.conversions.map((v, n) => n === i ? { ...v, unit: e.target.value as FoodUnit } : v) })}>{units()}</select></label><label>对应参考数量（{foodUnitLabels[form.basisUnit]}）<input inputMode="decimal" value={c.basisQuantity} onChange={e => update({ conversions: form.conversions.map((v, n) => n === i ? { ...v, basisQuantity: e.target.value } : v) })}/></label></div><button className="text-button" onClick={() => update({ conversions: form.conversions.filter((_, n) => n !== i) })}>移除此换算</button></div>)}
          <button className="button secondary small" disabled={form.conversions.length >= 4} onClick={() => update({ conversions: [...form.conversions, { unit: "package", quantity: "1", basisQuantity: "" }] })}>添加换算关系</button>
          <div className="form-grid"><label>净含量（可空）<input inputMode="decimal" value={form.netQuantity} onChange={e => update({ netQuantity: e.target.value })}/></label><label>净含量单位<select value={form.netUnit} onChange={e => update({ netUnit: e.target.value as LabelDraftForm["netUnit"] })}>{["g", "kg", "ml", "l"].map(u => <option key={u}>{u}</option>)}</select></label><label>沥干物重量（可空）<input inputMode="decimal" value={form.drainedQuantity} onChange={e => update({ drainedQuantity: e.target.value })}/></label><label>沥干物单位<select value={form.drainedUnit} onChange={e => update({ drainedUnit: e.target.value as "g" | "kg" })}><option>g</option><option>kg</option></select></label></div>
        </details>
        <label>来源与核对备注（可空）<textarea maxLength={1000} value={form.sourceNote} onChange={e => update({ sourceNote: e.target.value })}/></label>
      </fieldset>
      {preview ? <div className="label-preview"><h3>换算预览</h3>{([["当前参考规格", preview.nutrition], ["每 100 克", form.basisUnit === "g" && Number(form.basisQuantity) === 100 ? undefined : preview.per100g], ["每 100 毫升", form.basisUnit === "ml" && Number(form.basisQuantity) === 100 ? undefined : preview.per100ml]] as const).map(([label, facts]) => facts && <div key={label}><strong>{label}</strong><span>能量 {nutrientLabel(facts, "calories")} kcal · 蛋白质 {nutrientLabel(facts, "protein")} g · 钠 {nutrientLabel(facts, "sodium")} mg</span></div>)}<small>其余营养按相同规格换算；未提供重量／容量关系时，不派生对应每 100 克／毫升资料。</small></div> : <p className="recipe-context-note">待补全：{previewError} 可以先存草稿。</p>}
      {!readonly && <>
        <button className="button secondary" disabled={action.busy || !dirty} onClick={() => void save()}>{action.busy ? "正在处理…" : "保存草稿（允许未填完）"}</button>
        <div className="label-review"><h3>核对后建档</h3>{dirty && <p>有未保存修改，请先保存，再核对当前版本。</p>}{Object.entries(labelReviewItems).map(([key, text]) => <label key={key} className="checkbox-label"><input type="checkbox" disabled={action.busy || dirty || !preview} checked={review[key as keyof typeof review]} onChange={e => setReview(v => ({ ...v, [key]: e.target.checked }))}/><span>{text}</span></label>)}
          <details><summary>已有同名资料时</summary><label className="checkbox-label"><input type="checkbox" checked={allowDuplicate} disabled={action.busy} onChange={e => setAllowDuplicate(e.target.checked)}/><span>我已核对，确实需要另建同名、同品牌、同状态的食物；不覆盖原资料</span></label></details>
          <button className="button primary wide" disabled={action.busy || dirty || !identity || !preview || !Object.values(review).every(Boolean)} onClick={() => void confirm()}>确认建立食材资料</button>
        </div>
        {identity && <details><summary>忽略这个草稿</summary><label>忽略原因<input maxLength={500} value={reason} onChange={e => setReason(e.target.value)}/></label><button className="text-button warning-text" disabled={action.busy || dirty || !reason.trim()} onClick={async () => { const payload = { draftId: identity.id, expectedRevision: identity.revision, reason }; const r = await action.run(`discard:${JSON.stringify(payload)}`, id => command("discard_label_draft", payload, id)); if (!r.error) { setStatus("discarded"); setMessage("草稿已忽略，来源和修改记录保留，未建立食材。"); notifyLabelDrafts(); } }}>确认忽略，保留记录</button></details>}
      </>}
      {(action.message || message) && <p role="status" className={action.message ? "form-error" : "recipe-context-note"}>{action.message || message}</p>}
      {readonly && <p>状态：{statuses[status]}。此来源记录只读，后续修改食材会新建营养版本，不改写本记录。</p>}
      {closing && <div className="label-close-warning" role="alert"><p>有尚未保存的内容。先保存草稿可在重启后继续；直接关闭会丢失本次修改。</p><div className="button-row"><button className="button secondary" onClick={() => setClosing(false)}>返回继续整理</button><button className="text-button warning-text" onClick={onClose}>放弃未保存修改并关闭</button></div></div>}
    </div>
  </Modal>;
}
