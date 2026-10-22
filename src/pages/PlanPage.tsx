import { ShoppingCart } from "lucide-react";
import { PageHeader } from "../components/PageHeader";
import { useAppStore } from "../store/appStore";
import { useConfirmedAction } from "../components/useConfirmedAction";
import { isDemoPlan } from "../domain/diary";
import type { PlanCandidate } from "../domain/types";

/**
 * 次日菜单 · 紧凑表格（0.6.0 定稿形态）。
 *
 * 旧版三卡（幽灵数字/覆盖进度条/reason-chips/双 footer）已按用户反馈删除；
 * M3 接入动态菜单或 AI 草稿时，只替换数据来源，布局不变。
 * 来源胶囊：演示（种子数据）/ AI 草稿（M3）/ 已选。
 */
export function PlanPage() {
  const plans = useAppStore((state) => state.plans);
  const selectPlan = useAppStore((state) => state.selectPlan);
  const action = useConfirmedAction();

  const restock = new Set<string>();
  for (const plan of plans) {
    for (const item of plan.missingIngredients) restock.add(item);
  }

  return (
    <div className="page">
      <PageHeader
        eyebrow="明日确定"
        title="次日菜单"
        description="动态菜单与 AI 草稿导入尚未接通；下面保留界面示例。选中方案不会自动扣库存，也不会计入摄入。"
      />
      {action.message && <div className="settings-notice card" role="alert">{action.message}</div>}
      <div className="settings-notice card" role="status">当前为演示菜单。日常记录请从饮食页选择食物、确认实际制作与进食；这些示例不会自动计入摄入或扣库存。</div>

      <section className="card plan-table-card">
        <table>
          <thead>
            <tr>
              <th>候选与理由</th>
              <th>热量 kcal</th>
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
                  <td className="num">{plan.caloriesKcal}</td>
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

      <p className="form-hint">动态菜单与 AI 草稿导入在路线图 M3；后两日预测待接入，届时在这里展示。</p>
    </div>
  );
}

function sourceBadge(plan: PlanCandidate): { text: string; cls: string } | null {
  if (isDemoPlan(plan.id)) return { text: "演示", cls: "flat" };
  if (plan.status === "selected") return { text: "已选", cls: "ok" };
  return null;
}

function confirmLabel(plan: PlanCandidate): string {
  if (isDemoPlan(plan.id)) return "演示方案 · 不可确认为正式菜单";
  if (plan.status === "selected") return "已作为明日计划";
  if (!plan.recipeVersionId) return "待补齐标准菜谱";
  if (plan.inventoryCoverage < 100 || plan.missingIngredients.length) return "待实际收货后校验";
  return "选它";
}
