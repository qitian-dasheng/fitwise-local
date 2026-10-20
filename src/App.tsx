import { Archive, Bot, ChartNoAxesCombined, ChevronLeft, ChevronRight, ClipboardList, CookingPot, Dumbbell, Inbox, LayoutDashboard, Settings, Wheat } from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";
import { useAppStore } from "./store/appStore";

const TodayPage = lazy(() => import("./pages/TodayPage").then((module) => ({ default: module.TodayPage })));
const FoodPage = lazy(() => import("./pages/FoodPage").then((module) => ({ default: module.FoodPage })));
const WorkoutPage = lazy(() => import("./pages/WorkoutPage").then((module) => ({ default: module.WorkoutPage })));
const InventoryPage = lazy(() => import("./pages/InventoryPage").then((module) => ({ default: module.InventoryPage })));
const PlanPage = lazy(() => import("./pages/PlanPage").then((module) => ({ default: module.PlanPage })));
const TrendsPage = lazy(() => import("./pages/TrendsPage").then((module) => ({ default: module.TrendsPage })));
const InboxPage = lazy(() => import("./pages/InboxPage").then((module) => ({ default: module.InboxPage })));
const AssistantPage = lazy(() => import("./pages/AssistantPage").then((module) => ({ default: module.AssistantPage })));
const SettingsPage = lazy(() => import("./pages/SettingsPage").then((module) => ({ default: module.SettingsPage })));

const navItems = [
  { id: "today", label: "今日", icon: LayoutDashboard },
  { id: "food", label: "饮食", icon: CookingPot },
  { id: "workout", label: "运动", icon: Dumbbell },
  { id: "inventory", label: "库存", icon: Archive },
  { id: "plan", label: "计划", icon: ClipboardList },
  { id: "trends", label: "趋势", icon: ChartNoAxesCombined },
  { id: "inbox", label: "收件箱", icon: Inbox },
  { id: "assistant", label: "AI 助手", icon: Bot },
] as const;

export default function App() {
  const [page, setPage] = useState("today");
  const [collapsed, setCollapsed] = useState(false);
  const inboxCount = useAppStore((state) => state.inbox.filter((item) => item.status === "unreviewed").length);
  const profile = useAppStore((state) => state.profile);
  const hydrated = useAppStore.persist.hasHydrated();
  const [, forceRender] = useState(0);
  useEffect(() => useAppStore.persist.onFinishHydration(() => forceRender((value) => value + 1)), []);

  const content = {
    today: <TodayPage goTo={setPage} />,
    food: <FoodPage />,
    workout: <WorkoutPage />,
    inventory: <InventoryPage />,
    plan: <PlanPage />,
    trends: <TrendsPage />,
    inbox: <InboxPage />,
    assistant: <AssistantPage />,
    settings: <SettingsPage />,
  }[page] ?? <TodayPage goTo={setPage} />;

  if (!hydrated) return <div className="loading-screen"><Wheat size={34}/><strong>正在打开轻衡…</strong></div>;

  return (
    <div className={`app-shell ${collapsed ? "sidebar-collapsed" : ""}`}>
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark"><Wheat size={22}/></div><div><strong>轻衡</strong><span>Fitwise Local</span></div></div>
        <nav>{navItems.map((item) => <button key={item.id} className={page === item.id ? "active" : ""} onClick={() => setPage(item.id)} title={item.label}><item.icon size={19}/><span>{item.label}</span>{item.id === "inbox" && inboxCount > 0 && <b className="nav-badge">{inboxCount}</b>}</button>)}</nav>
        <div className="sidebar-bottom"><button className={page === "settings" ? "active" : ""} onClick={() => setPage("settings")}><Settings size={19}/><span>设置</span></button><div className="profile-mini"><div>{profile.name.slice(0, 1)}</div><span><strong>{profile.name}</strong><small>本地账户</small></span></div></div>
        <button className="collapse-button" onClick={() => setCollapsed((value) => !value)}>{collapsed ? <ChevronRight size={16}/> : <ChevronLeft size={16}/>}</button>
      </aside>
      <main className="main-content"><Suspense fallback={<div className="page page-loading"><Wheat size={28}/><span>正在加载页面…</span></div>}>{content}</Suspense></main>
    </div>
  );
}
