import { useEffect, useMemo, useState } from "react";
import { Minus, PencilLine, Plus, Trash2 } from "lucide-react";
import { useAppStore } from "../store/appStore";
import { useConfirmedAction } from "./useConfirmedAction";
import { Modal } from "./Modal";
import { foodUnitLabels } from "../domain/foodLibrary";
import { daysUntilExpiry, isLowStock, pantryStepForUnit } from "../domain/pantry";
import { diaryToday } from "../domain/diary";
import type { FoodUnit, PantryItem } from "../domain/types";

/**
 * 食物柜（0.9.4 库存轻量版）：只回答「家里还有什么、快没了没」。
 * 挂在食材库页的食物柜分组里；快捷 ± 增减为主界面，入库/编辑走小弹窗。
 * 与饮食记录完全解耦：不自动扣减、不反推摄入、无成本账。
 */
const UNIT_OPTIONS: FoodUnit[] = ["g", "ml", "piece", "serving", "package"];

export function PantryPanel() {
  const pantryItems = useAppStore((state) => state.pantryItems);
  const definitions = useAppStore((state) => state.foodDefinitions);
  const action = useConfirmedAction();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<PantryItem | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

  const byDefinition = new Map(definitions.map((item) => [item.id, item]));
  const today = diaryToday();
  const sorted = [...pantryItems].sort((a, b) => {
    const nameA = byDefinition.get(a.foodDefinitionId)?.name ?? "";
    const nameB = byDefinition.get(b.foodDefinitionId)?.name ?? "";
    return nameA.localeCompare(nameB, "zh-Hans-CN");
  });

  function adjust(item: PantryItem, delta: number) {
    void action.run(`pantry:${item.id}:${delta}:${Date.now()}`, async (id) => {
      const result = await useAppStore.getState().pantryAdjust({ foodDefinitionId: item.foodDefinitionId, delta, unit: item.unit }, id);
      if (!result.error && item.quantity + delta <= 0) setNotice(`「${byDefinition.get(item.foodDefinitionId)?.name ?? "该食材"}」已取空。`);
      return result;
    });
  }

  return (
    <div className="pantry-panel">
      <div className="pantry-toolbar">
        <p className="form-hint" style={{ margin: 0, flex: 1 }}>家里有什么、快没了没。只做提示，不自动扣减饮食记录。</p>
        <button className="ui-btn primary" onClick={() => { action.setMessage(""); setAdding(true); }}><Plus size={15}/> 入库</button>
      </div>
      {notice && <p className="library-notice" role="status">{notice}</p>}
      {action.message && <p className="form-error" role="alert">{action.message}</p>}

      {sorted.length === 0 ? (
        <div className="library-empty">
          <strong>食物柜还是空的</strong>
          <p>入库后，菜谱行会提示「还缺什么」；低存量会高亮提醒补货。</p>
        </div>
      ) : (
        <div className="pantry-list">
          {sorted.map((item) => {
            const definition = byDefinition.get(item.foodDefinitionId);
            const low = isLowStock(item);
            const expiry = daysUntilExpiry(item, today);
            const step = pantryStepForUnit(item.unit);
            return (
              <div key={item.id}>
                <div className={`pantry-item${low ? " low" : ""}`}>
                  <div className="pantry-item-main">
                    <strong>{definition?.name ?? "未知食材（可能已删除）"}</strong>
                    <span>
                      {item.quantity > 0 ? `${item.quantity} ${foodUnitLabels[item.unit]}` : "已取空"}
                      {item.lowStockThreshold !== undefined && ` · 提醒线 ${item.lowStockThreshold}`}
                      {expiry !== null && ` · ${expiry < 0 ? "已过期" : expiry === 0 ? "今天到期" : `${expiry} 天后到期`}`}
                      {item.note ? ` · ${item.note}` : ""}
                    </span>
                  </div>
                  {low && <span className="ui-badge warn">{item.quantity <= 0 ? "没货" : "快没了"}</span>}
                  <span className="pantry-item-actions">
                    <button className="icon-button" aria-label={`取出${step}`} title={`取出 ${step} ${foodUnitLabels[item.unit]}`} disabled={action.busy || item.quantity <= 0} onClick={() => adjust(item, -step)}><Minus size={15}/></button>
                    <b className="pantry-quantity">{item.quantity}</b>
                    <button className="icon-button" aria-label={`入库${step}`} title={`入库 ${step} ${foodUnitLabels[item.unit]}`} disabled={action.busy} onClick={() => adjust(item, step)}><Plus size={15}/></button>
                    <button className="icon-button" aria-label={`编辑${definition?.name ?? ""}的提醒线与到期日`} disabled={action.busy} onClick={() => { action.setMessage(""); setPendingDelete(null); setEditing(item); }}><PencilLine size={15}/></button>
                    <button className="icon-button" aria-label={`从食物柜移除${definition?.name ?? ""}`} disabled={action.busy} onClick={() => { action.setMessage(""); setPendingDelete(item.id); }}><Trash2 size={15}/></button>
                  </span>
                </div>
                {pendingDelete === item.id && (
                  <div className="delete-confirm" role="alert">
                    <strong>从食物柜移除「{definition?.name ?? "该食材"}」？</strong>
                    <span>只删柜内条目，不动食材库资料，也不影响任何饮食记录。</span>
                    <div className="button-row">
                      <button className="button danger small" disabled={action.busy} onClick={() => { void action.run(`pantry-del:${item.id}`, async (id) => { const result = await useAppStore.getState().pantryDeleteItem(item.id, id); if (!result.error) { setPendingDelete(null); setNotice(`已从食物柜移除「${definition?.name ?? "该食材"}」。`); } return result; }); }}>确认移除</button>
                      <button className="button secondary small" disabled={action.busy} onClick={() => setPendingDelete(null)}>取消</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {adding && <PantryEntryModal onClose={() => setAdding(false)} action={action} onSaved={(name) => { setAdding(false); setNotice(`已入库「${name}」。`); }} />}
      {editing && (
        <Modal title="编辑柜内条目" onClose={() => setEditing(null)}>
          <PantryEditForm item={editing} action={action} onDone={() => setEditing(null)} />
        </Modal>
      )}
    </div>
  );
}

function PantryEntryModal({ onClose, action, onSaved }: { onClose: () => void; action: ReturnType<typeof useConfirmedAction>; onSaved: (name: string) => void }) {
  // 选择器只取稳定引用，派生一律在组件体内用 useMemo——
  // 在选择器里 map/filter 会每次返回新数组，useSyncExternalStore 判定快照变化，无限重渲染（React #185）。
  const definitions = useAppStore((state) => state.foodDefinitions);
  const pantryItems = useAppStore((state) => state.pantryItems);
  const [form, setForm] = useState({ foodDefinitionId: "", quantity: "", unit: "g" as FoodUnit, expiresAt: "", lowStockThreshold: "", note: "" });
  const candidates = useMemo(
    () => definitions.filter((item) => item.archived !== true && !pantryItems.some((entry) => entry.foodDefinitionId === item.id)),
    [definitions, pantryItems],
  );
  const target = candidates.find((item) => item.id === form.foodDefinitionId) ?? candidates[0];
  // 候选集异步就绪后把默认选中补上（初值留空避免渲染期写 store）。
  useEffect(() => {
    if (!form.foodDefinitionId && target) setForm((current) => ({ ...current, foodDefinitionId: target.id }));
  }, [target, form.foodDefinitionId]);

  return (
    <Modal title="入库" onClose={() => { if (!action.busy) onClose(); }}>
      {candidates.length === 0 ? (
        <p className="form-hint">库里的食材都已在柜内或还没有建档。增减数量请回到列表用 ± 按钮。</p>
      ) : (
        <form className="form" onSubmit={async (event) => {
          event.preventDefault();
          if (!target) return;
          const quantity = Number(form.quantity);
          if (!Number.isFinite(quantity) || quantity <= 0) { action.setMessage("入库数量需大于 0。"); return; }
          const payload = {
            foodDefinitionId: target.id,
            delta: quantity,
            unit: form.unit,
            ...(form.expiresAt ? { expiresAt: form.expiresAt } : {}),
            ...(form.lowStockThreshold ? { lowStockThreshold: Number(form.lowStockThreshold) } : {}),
            ...(form.note.trim() ? { note: form.note.trim() } : {}),
          };
          const result = await action.run(JSON.stringify(payload), (id) => useAppStore.getState().pantryAdjust(payload, id));
          if (!result.error) onSaved(target.name);
        }}>
          <label><span>食材（未入柜的建档食材）</span>
            <select value={target?.id ?? ""} onChange={(event) => setForm({ ...form, foodDefinitionId: event.target.value })}>
              {candidates.map((item) => <option key={item.id} value={item.id}>{item.name}{item.brand ? ` · ${item.brand}` : ""}</option>)}
            </select>
          </label>
          <div className="form-grid">
            <label><span>数量</span><input type="number" required min="0" step="0.01" value={form.quantity} onChange={(event) => setForm({ ...form, quantity: event.target.value })} placeholder="例如 500" /></label>
            <label><span>单位</span>
              <select value={form.unit} onChange={(event) => setForm({ ...form, unit: event.target.value as FoodUnit })}>
                {UNIT_OPTIONS.map((unit) => <option key={unit} value={unit}>{foodUnitLabels[unit]}</option>)}
              </select>
            </label>
          </div>
          <div className="form-grid">
            <label><span>到期日（可空）</span><input type="date" value={form.expiresAt} onChange={(event) => setForm({ ...form, expiresAt: event.target.value })} /></label>
            <label><span>低存量提醒线（可空）</span><input type="number" min="0" step="0.01" value={form.lowStockThreshold} onChange={(event) => setForm({ ...form, lowStockThreshold: event.target.value })} placeholder="低于它就提醒补货" /></label>
          </div>
          <label><span>备注（可空）</span><input maxLength={80} value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} placeholder="例如 冰箱冷藏" /></label>
          <p className="form-hint">单位入库后不可再改（增减必须同单位）；换算请交给食材库换算器，食物柜不做隐式换算。</p>
          {action.message && <p className="form-error" role="alert">{action.message}</p>}
          <div className="button-row">
            <button className="button primary" type="submit" disabled={action.busy}>{action.busy ? "正在保存…" : "入库"}</button>
            <button className="button secondary" type="button" disabled={action.busy} onClick={onClose}>取消</button>
          </div>
        </form>
      )}
    </Modal>
  );
}

function PantryEditForm({ item, action, onDone }: { item: PantryItem; action: ReturnType<typeof useConfirmedAction>; onDone: () => void }) {
  const [form, setForm] = useState({
    expiresAt: item.expiresAt ?? "",
    lowStockThreshold: item.lowStockThreshold !== undefined ? String(item.lowStockThreshold) : "",
    note: item.note ?? "",
  });
  return (
    <form className="form" onSubmit={async (event) => {
      event.preventDefault();
      const payload = {
        id: item.id,
        lowStockThreshold: form.lowStockThreshold === "" ? null : Number(form.lowStockThreshold),
        expiresAt: form.expiresAt === "" ? null : form.expiresAt,
        note: form.note.trim() === "" ? null : form.note.trim(),
      };
      const result = await action.run(JSON.stringify(payload), (id) => useAppStore.getState().pantryUpdateItem(payload, id));
      if (!result.error) onDone();
    }}>
      <label><span>到期日（清空＝不限）</span><input type="date" value={form.expiresAt} onChange={(event) => setForm({ ...form, expiresAt: event.target.value })} /></label>
      <label><span>低存量提醒线（清空＝不提醒）</span><input type="number" min="0" step="0.01" value={form.lowStockThreshold} onChange={(event) => setForm({ ...form, lowStockThreshold: event.target.value })} /></label>
      <label><span>备注</span><input maxLength={80} value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} /></label>
      {action.message && <p className="form-error" role="alert">{action.message}</p>}
      <div className="button-row">
        <button className="button primary" type="submit" disabled={action.busy}>{action.busy ? "正在保存…" : "保存"}</button>
        <button className="button secondary" type="button" disabled={action.busy} onClick={onDone}>取消</button>
      </div>
    </form>
  );
}
