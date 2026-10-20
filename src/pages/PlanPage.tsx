import { Check, Clock3, PackageCheck, ShoppingCart, Sparkles, WalletCards } from "lucide-react";
import { PageHeader } from "../components/PageHeader";
import { useAppStore } from "../store/appStore";
import { useConfirmedAction } from "../components/useConfirmedAction";
import { isDemoPlan } from "../domain/diary";

export function PlanPage() {
  const plans = useAppStore((state) => state.plans);
  const selectPlan = useAppStore((state) => state.selectPlan);
  const action = useConfirmedAction();
  return (
    <div className="page">
      <PageHeader eyebrow="明日确定 · 后两日预演" title="次日菜单" description="动态菜单与后两日预测尚未接通。下面保留界面示例，不代表按你的库存生成的实际建议。" />
      <div className="settings-notice card" role="status">当前为演示菜单。日常记录请从饮食页选择食物、确认实际制作与进食；这些示例不会自动计入摄入或扣库存。</div>
      {action.message && <div className="settings-notice card" role="alert">{action.message}</div>}
      <div className="plan-context card">
        <div><PackageCheck size={20} /><span>临期优先</span><b>尚未实时计算</b></div>
        <div><Clock3 size={20} /><span>工作日上限</span><b>30 分钟</b></div>
        <div><WalletCards size={20} /><span>预算策略</span><b>两周后建议</b></div>
        <div><Sparkles size={20} /><span>计划状态</span><b>演示预览</b></div>
      </div>
      <section className="plan-grid">
        {plans.map((plan, index) => (
          <article className={`plan-card card ${plan.status === "selected" ? "selected" : ""}`} key={plan.id}>
            <div className="plan-number">0{index + 1}</div>
            <div className="plan-title-row"><div><p className="eyebrow">{isDemoPlan(plan.id) ? "演示样例 · 非个性化推荐" : "候选方案 · 需核对"}</p><h2>{plan.title}</h2></div>{plan.status === "selected" && <span className="selected-badge"><Check size={14} /> 已选</span>}</div>
            <p>{plan.description}</p>
            <div className="plan-stats"><span><b>{plan.caloriesKcal}</b> kcal / 整锅</span><span><b>{plan.proteinG}</b> g 蛋白质</span><span><b>{plan.fiberG}</b> g 纤维</span></div>
            <div className="plan-score"><div><span>样例库存覆盖（非实时）</span><b>{plan.inventoryCoverage}%</b></div><div className="score-bar"><i style={{ width: `${plan.inventoryCoverage}%` }} /></div></div>
            <div className="reason-chips">{plan.reasons.map((reason) => <span key={reason}>{reason}</span>)}</div>
            <div className="plan-footer"><div><small>预计成本</small><strong>¥ {plan.estimatedCostCny}</strong></div><div><small>烹饪时间</small><strong>{plan.cookingMinutes} 分钟</strong></div></div>
            {plan.missingIngredients.length > 0 && <div className="missing"><ShoppingCart size={17} /><span>需补货：{plan.missingIngredients.join("、")}</span></div>}
            <button className={plan.status === "selected" ? "button secondary wide" : "button primary wide"} disabled={isDemoPlan(plan.id) || action.busy || plan.status === "selected" || !plan.recipeVersionId || plan.inventoryCoverage < 100 || plan.missingIngredients.length > 0} onClick={() => { void action.run(plan.id, (id) => selectPlan(plan.id, id)); }}>{isDemoPlan(plan.id) ? "演示方案 · 不可确认为正式菜单" : plan.status === "selected" ? "已作为明日计划" : !plan.recipeVersionId ? "待补齐标准菜谱" : plan.inventoryCoverage < 100 || plan.missingIngredients.length ? "待实际收货后校验" : "选择这个方案"}</button>
          </article>
        ))}
      </section>
      <section className="card forecast"><div><p className="eyebrow">非承诺性预演</p><h2>后两日预测待接入</h2><p>目前没有基于实际库存和配送计算预测，不展示虚构尾料数量，也不会写入正式菜单。</p></div><div className="forecast-days"><div><span>后天</span><strong>尚未生成库存预演</strong><small>先记录实际收货与消耗</small></div><div><span>第三天</span><strong>尚未生成库存预演</strong><small>到货变化后重新计算</small></div></div></section>
    </div>
  );
}
