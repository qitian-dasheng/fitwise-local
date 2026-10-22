import { ClipboardList, CookingPot, Dumbbell, Inbox, LayoutDashboard, Scale, Settings } from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * 0.5 信息架构：主导航 5 项 + 工具 2 项。
 *
 * 归属规则（改前先读）：
 * - 库存 → 并入「饮食」页（做菜要用它）；
 * - 趋势 → 并入「身体」页（录入与趋势同页）；
 * - AI 助手 → 不进导航，Ctrl/⌘+K 或右下角浮标唤起；
 * - 收件箱、设置 → 低频，放「工具」分组。
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
  { id: "plan", label: "计划", icon: ClipboardList },
];

export const toolItems: NavEntry[] = [
  { id: "inbox", label: "收件箱", icon: Inbox },
  { id: "settings", label: "设置", icon: Settings },
];

/** 旧版页面 id → 现在的去处。用于兜底：任何还在往这些 id 跳的旧代码都能落对地方。 */
export const legacyPageTargets: Record<string, string> = {
  inventory: "food",
  trends: "body",
  assistant: "today",
};
