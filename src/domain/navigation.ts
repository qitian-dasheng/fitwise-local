import { CookingPot, Dumbbell, LayoutDashboard, Library, Scale, Settings } from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * 0.9 信息架构：主导航 4 项 + 工具区。
 *
 * 归属规则（改前先读）：
 * - 趋势 → 并入「身体」页（录入与趋势同页）；
 * - 设置/食材库 → 低频或资产管理，放「工具」分组；记餐的「选」仍在饮食页弹窗，建档与管理在食材库页。
 * 这里只定义 id 与图标，页面归属在 App.tsx 的 content 里组装。
 */

export interface NavEntry {
  id: string;
  label: string;
  icon: LucideIcon;
}

export const navItems: NavEntry[] = [
  { id: "today", label: "今日", icon: LayoutDashboard },
  { id: "food", label: "饮食", icon: CookingPot },
  { id: "body", label: "身体", icon: Scale },
  { id: "workout", label: "运动", icon: Dumbbell },
];

export const toolItems: NavEntry[] = [
  { id: "library", label: "食材库", icon: Library },
  { id: "settings", label: "设置", icon: Settings },
];

/** 旧版页面 id → 现在的去处。用于兜底：任何还在往这些 id 跳的旧代码都能落对地方。 */
export const legacyPageTargets: Record<string, string> = {
  trends: "body",
};
