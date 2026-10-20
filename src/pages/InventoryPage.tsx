import { differenceInCalendarDays, format } from "date-fns";
import { Box, Check, PackageCheck, Plus, RefreshCcw, ShoppingBag } from "lucide-react";
import { useState } from "react";
import { PageHeader } from "../components/PageHeader";
import { Modal } from "../components/Modal";
import { useAppStore } from "../store/appStore";
import type { PurchaseDraft } from "../domain/types";

export function InventoryPage() {
  const [purchaseOpen, setPurchaseOpen] = useState(false);
  const inventory = useAppStore((state) => state.inventory);
  const purchases = useAppStore((state) => state.purchases);
  const addPurchase = useAppStore((state) => state.addPurchase);
  const receivePurchase = useAppStore((state) => state.receivePurchase);
  const totalValue = inventory.reduce((sum, item) => sum + item.purchasePriceCny * (item.remainingAmount / item.purchasedAmount), 0);
  const expiring = inventory.filter((item) => item.expiresAt && differenceInCalendarDays(new Date(item.expiresAt), new Date()) <= 3 && item.remainingAmount > 0);

  return (
    <div className="page">
      <PageHeader eyebrow="原料与成本" title="食材库存" description="库存是可校正的估计，而不是不可修改的绝对真值。" action={<button className="button primary" onClick={() => setPurchaseOpen(true)}><Plus size={17} /> 记录采购</button>} />
      <div className="metric-row">
        <Metric icon={<Box />} label="在库批次" value={`${inventory.filter((item) => item.remainingAmount > 0).length} 个`} />
        <Metric icon={<RefreshCcw />} label="已开封" value={`${inventory.filter((item) => item.opened && item.remainingAmount > 0).length} 个`} />
        <Metric icon={<PackageCheck />} label="三日内到期" value={`${expiring.length} 个`} warning={expiring.length > 0} />
        <Metric icon={<ShoppingBag />} label="剩余库存成本" value={`¥ ${totalValue.toFixed(2)}`} />
      </div>

      <section className="card table-card">
        <div className="card-heading compact"><div><p className="eyebrow">FEFO</p><h2>库存批次</h2></div><span className="status-pill neutral">已开封 → 临期 → 先购买</span></div>
        <div className="data-table">
          <div className="table-row table-head"><span>食材</span><span>余量</span><span>状态</span><span>到期</span><span>来源</span></div>
          {[...inventory].sort((a, b) => Number(b.opened) - Number(a.opened) || (a.expiresAt ?? "9999").localeCompare(b.expiresAt ?? "9999")).map((item) => {
            const percent = Math.max(0, (item.remainingAmount / item.purchasedAmount) * 100);
            const days = item.expiresAt ? differenceInCalendarDays(new Date(item.expiresAt), new Date()) : null;
            return (
              <div className="table-row" key={item.id}>
                <span><strong>{item.name}</strong><small>批次 {item.id.slice(-6)}</small></span>
                <span><strong>{item.remainingAmount} {item.unit}</strong><i className="stock-bar"><i style={{ width: `${percent}%` }} /></i></span>
                <span>{item.opened ? <em className="status-pill warning">已开封</em> : <em className="status-pill neutral">未开封</em>}</span>
                <span className={days !== null && days <= 3 ? "warning-text" : ""}>{days === null ? "未设置" : days < 0 ? "已过期" : `${days} 天`}</span>
                <span>{item.source ?? "手工"}</span>
              </div>
            );
          })}
        </div>
      </section>

      {purchases.length > 0 && <section className="card"><div className="card-heading compact"><div><p className="eyebrow">采购流水</p><h2>待收货</h2></div></div><div className="purchase-list">{purchases.filter((item) => item.status !== "received").map((item) => <div className="purchase-row" key={item.id}><div><strong>{item.name}</strong><span>{item.platform} · {item.amount}{item.unit} · ¥{item.priceCny}</span></div><span>{item.expectedArrival ?? "未设置到货日"}</span><button className="button secondary small" onClick={() => receivePurchase(item.id)}><Check size={15} /> 确认收货</button></div>)}</div></section>}

      {purchaseOpen && <PurchaseModal onClose={() => setPurchaseOpen(false)} onSave={(draft) => { addPurchase(draft); setPurchaseOpen(false); }} />}
    </div>
  );
}

function Metric({ icon, label, value, warning }: { icon: React.ReactNode; label: string; value: string; warning?: boolean }) {
  return <article className={`metric-card icon-metric ${warning ? "warn-card" : ""}`}><span className="metric-icon">{icon}</span><div><span>{label}</span><strong>{value}</strong></div></article>;
}

type PurchaseInput = Omit<PurchaseDraft, "id">;

function PurchaseModal({ onClose, onSave }: { onClose: () => void; onSave: (draft: PurchaseInput) => void }) {
  const [form, setForm] = useState<{
    name: string;
    platform: PurchaseDraft["platform"];
    url: string;
    amount: string;
    unit: PurchaseDraft["unit"];
    priceCny: string;
    expectedArrival: string;
  }>({ name: "", platform: "duoduo", url: "", amount: "", unit: "g", priceCny: "", expectedArrival: format(new Date(Date.now() + 864e5), "yyyy-MM-dd") });
  return <Modal title="创建待确认采购" onClose={onClose}><form className="form" onSubmit={(event) => { event.preventDefault(); onSave({ ...form, amount: Number(form.amount), priceCny: Number(form.priceCny), status: "ordered", confidence: "high" }); }}>
    <label><span>食材或商品</span><input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="例如 猪里脊" /></label>
    <div className="form-grid"><label><span>渠道</span><select value={form.platform} onChange={(event) => setForm({ ...form, platform: event.target.value as typeof form.platform })}><option value="duoduo">多多买菜</option><option value="online">普通网购</option><option value="supermarket">超市</option><option value="other">其他</option></select></label><label><span>预计到货</span><input type="date" value={form.expectedArrival} onChange={(event) => setForm({ ...form, expectedArrival: event.target.value })} /></label></div>
    <div className="form-grid"><label><span>数量</span><input required type="number" min="0" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} /></label><label><span>单位</span><select value={form.unit} onChange={(event) => setForm({ ...form, unit: event.target.value as typeof form.unit })}><option value="g">克</option><option value="ml">毫升</option><option value="piece">个</option></select></label></div>
    <label><span>实付金额</span><input required type="number" min="0" step="0.01" value={form.priceCny} onChange={(event) => setForm({ ...form, priceCny: event.target.value })} /></label>
    <label><span>商品链接（可选）</span><input value={form.url} onChange={(event) => setForm({ ...form, url: event.target.value })} placeholder="粘贴商品链接" /></label>
    <p className="form-hint">“已下单”不会增加库存；确认实际收货后才建立库存批次。</p><button className="button primary wide" type="submit">保存为已下单</button>
  </form></Modal>;
}
