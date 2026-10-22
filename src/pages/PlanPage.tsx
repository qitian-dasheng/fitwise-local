import { ShoppingCart } from "lucide-react";
import { PageHeader } from "../components/PageHeader";
import { useAppStore } from "../store/appStore";
import { useConfirmedAction } from "../components/useConfirmedAction";
import { AiSummaryPanel } from "../components/AiSummaryPanel";
import { MenuDraftsPanel } from "../components/MenuDraftsPanel";
import { isDemoPlan } from "../domain/diary";
import type { PlanCandidate } from "../domain/types";
import { useEnergyUnit } from "../hooks/useEnergyUnit";
import { energyUnitLabels, toDisplayEnergy } from "../domain/energyDisplay";

/**
 * 次日菜单 · 紧凑表格（0.6.0 定稿形态）+ M3 通道（授权摘要导出 + AI 草稿导入确认）。
 *
 * 旧版三卡（幽灵数字/覆盖进度条/reason-chips/双 footer）已按用户反馈删除；
 * M3 接入 AI 草稿后布局不变：草稿在下方独立面板逐条确认，确认后才进候选表。
 * 来源胶囊：演示（种子数据）/ AI 草稿（经草稿通道确认）/ 已选。
 */
export function PlanPage() {
  const plans = useAppStore((state) => state.plans);
  const selectPlan = useAppStore((state) => state.selectPlan);
  const action = useConfirmedAction();
  const [energyUnit] = useEnergyUnit();

  const restock = new Set<string>();
  for (const plan of plans) {
    for (const item of plan.missingIngredients) restock.add(item);
  }
  const hasDemoPlans = plans.some((plan) => isDemoPlan(plan.id));

  return (
    <div className="page">
      <PageHeader
        eyebrow="明日确定"
        title="次日菜单"
        description="把授权摘要发给外部 AI 换一份菜单草稿；导入核对后确认进候选。选中方案不会自动扣库存，也不会计入摄入。"
      />
      {action.message && <div className="settings-notice card" role="alert">{action.message}</div>}
      {hasDemoPlans && <div className="settings-notice card" role="status">当前为演示菜单。日常记录请从饮食页选择食物、确认实际制作与进食；这些示例不会自动计入摄入或扣库存。</div>}

      <AiSummaryPanel />
      <MenuDraftsPanel />

      <section className="card plan-table-card">
        <table>
          <thead>
            <tr>
              <th>候选与理由</th>
              <th>热量 {energyUnitLabels[energyUnit]}</th>
              <th>蛋白 g</th>
              <th>成本 ¥</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {plans.map((plan) => {
              const badge = sourceBadge(plan);
              const disabled = isDemoPlan(plan.id) || action.busy || plan.status === "selected" || !plan.recipeVersionId || plan.inventoryCoverage < 100 || plan.missingIngredients.length > 0;
              const label = confirmLabel(plan);
              return (
                <tr key={plan.id} className={plan.status === "selected" ? "selected" : ""}>
                  <td className="candidate">
                    <b>
                      {plan.title}
                      {badge && <span className={`status-pill ${badge.cls}`}>{badge.text}</span>}
                    </b>
                    <span>{plan.description}</span>
                    {plan.missingIngredients.length > 0 && (
                      <span className="plan-missing">需补货：{plan.missingIngredients.join("、")}</span>
                    )}
                  </td>
                  <td className="num">{Math.round(toDisplayEnergy(plan.caloriesKcal, energyUnit))}</td>
                  <td className="num">{plan.proteinG}</td>
                  <td className="num">{plan.estimatedCostCny}</td>
                  <td>
                    <button className="link" disabled={disabled || action.busy} onClick={() => { void action.run(plan.id, (id) => selectPlan(plan.id, id)); }}>
                      {label}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="plan-restock">
          <span className="hint">
            {restock.size ? `补货清单：${[...restock].join("、")}` : "库存齐备，暂无补货需求。"}
          </span>
          <button className="button secondary" disabled title="M3 接入动态菜单后可用">生成采购草稿</button>
        </div>
      </section>

      <p className="form-hint">确认进菜单的 AI 草稿与候选一样，只在你点「选它」后成为明日计划；后续接通动态菜单后在此并列展示。</p>
    </div>
  );
}

function sourceBadge(plan: PlanCandidate): { text: string; cls: string } | null {
  if (isDemoPlan(plan.id)) return { text: "演示", cls: "flat" };
  if (plan.status === "selected") return { text: "已选", cls: "ok" };
  if (plan.origin === "ai-draft") return { text: "AI 草稿", cls: "info" };
  return null;
}

function confirmLabel(plan: PlanCandidate): string {
  if (isDemoPlan(plan.id)) return "演示方案 · 不可确认为正式菜单";
  if (plan.status === "selected") return "已作为明日计划";
  if (!plan.recipeVersionId) return "待补齐标准菜谱";
  if (plan.inventoryCoverage < 100 || plan.missingIngredients.length) return "待实际收货后校验";
  return "选它";
}
