import { Archive, Bot, ChartNoAxesCombined, ChevronLeft, ChevronRight, ClipboardList, CookingPot, Dumbbell, Inbox, LayoutDashboard, Scale, Settings, Wheat } from "lucide-react";
import { Component, lazy, Suspense, useEffect, useLayoutEffect, useState, useSyncExternalStore, type ErrorInfo, type ReactNode } from "react";
import { useAppStore } from "./store/appStore";
import { listen } from "@tauri-apps/api/event";
import { notifyInputs, useInputReceipts } from "./data/artifacts";
import { diaryToday } from "./domain/diary";
import { getStorageFailure, subscribeStorageFailure } from "./data/storage";

const TodayPage = lazy(() => import("./pages/TodayPage").then((module) => ({ default: module.TodayPage })));
const FoodPage = lazy(() => import("./pages/FoodPage").then((module) => ({ default: module.FoodPage })));
const BodyPage = lazy(() => import("./pages/BodyPage").then((module) => ({ default: module.BodyPage })));
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
  { id: "body", label: "身体", icon: Scale },
  { id: "workout", label: "运动", icon: Dumbbell },
  { id: "inventory", label: "库存", icon: Archive },
  { id: "plan", label: "计划", icon: ClipboardList },
  { id: "trends", label: "趋势", icon: ChartNoAxesCombined },
  { id: "inbox", label: "收件箱", icon: Inbox },
  { id: "assistant", label: "AI 助手", icon: Bot },
] as const;

class PageErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("页面渲染失败", error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="page page-error" role="alert">
        <Wheat size={30} />
        <h1>这个页面没有正常显示</h1>
        <p>页面显示失败不代表记录已删除。请保留当前窗口，先核对并保全记录；有未保存输入时不要重新加载。</p>
        <code>{this.state.error.message}</code>
        <button className="button primary" onClick={() => window.location.reload()}>重新加载应用</button>
      </div>
    );
  }
}

export default function App() {
  const [page, setPage] = useState("today");
  const [date, setDate] = useState(diaryToday);
  useEffect(() => {
    let previousToday = diaryToday();
    const tick = () => {
      const nextToday = diaryToday();
      if (previousToday !== nextToday) {
        const oldToday = previousToday;
        setDate(current => current === oldToday ? nextToday : current);
        previousToday = nextToday;
      }
    };
    const timer = window.setInterval(tick, 30000);
    window.addEventListener("focus", tick);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", tick); };
  }, []);
  const [collapsed, setCollapsed] = useState(false);
  const intake=useInputReceipts();
  const inboxCount = useAppStore((state) => state.inbox.filter((item) => item.status === "unreviewed").length)+intake.data.unreviewedCount;
  const profile = useAppStore((state) => state.profile);
  const hydrated = useAppStore.persist.hasHydrated();
  const storageFailure = useSyncExternalStore(subscribeStorageFailure, getStorageFailure);
  const [, forceRender] = useState(0);
  useEffect(() => useAppStore.persist.onFinishHydration(() => forceRender((value) => value + 1)), []);
  useEffect(()=>{
    if(!("__TAURI_INTERNALS__" in window))return;
    let disposed=false;let unlisten:(()=>void)|undefined;
    void listen("mobile-inbox-changed",notifyInputs).then(stop=>{if(disposed)stop();else unlisten=stop;}).catch(()=>undefined);
    return()=>{disposed=true;unlisten?.();};
  },[]);
  useLayoutEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [page]);

  const content = {
    today: <TodayPage goTo={setPage} date={date} onDateChange={setDate} />,
    food: <FoodPage date={date} onDateChange={setDate} />,
    body: <BodyPage date={date} onDateChange={setDate} />,
    workout: <WorkoutPage date={date} onDateChange={setDate} />,
    inventory: <InventoryPage />,
    plan: <PlanPage />,
    trends: <TrendsPage date={date} onDateChange={setDate} goTo={setPage} />,
    inbox: <InboxPage />,
    assistant: <AssistantPage />,
    settings: <SettingsPage />,
  }[page] ?? <TodayPage goTo={setPage} />;

  if (!hydrated) return <div className="loading-screen"><Wheat size={34}/><strong>{storageFailure ? "本地记录未能安全打开" : "正在打开轻衡…"}</strong>{storageFailure && <><p role="alert">{storageFailure}</p><p>未改用演示数据。请保留当前窗口，不要重置或清理应用数据。</p></>}</div>;

  return (
    <div className={`app-shell ${collapsed ? "sidebar-collapsed" : ""}`}>
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark"><Wheat size={22}/></div><div><strong>轻衡</strong><span>Fitwise Local</span></div></div>
        <nav>{navItems.map((item) => <button key={item.id} className={page === item.id ? "active" : ""} onClick={() => setPage(item.id)} title={item.label}><item.icon size={19}/><span>{item.label}</span>{item.id === "inbox" && inboxCount > 0 && <b className="nav-badge">{inboxCount}</b>}</button>)}</nav>
        <div className="sidebar-bottom"><button className={page === "settings" ? "active" : ""} onClick={() => setPage("settings")}><Settings size={19}/><span>设置</span></button><div className="profile-mini"><div>{profile.name.slice(0, 1)}</div><span><strong>{profile.name}</strong><small>本地账户</small></span></div></div>
        <button className="collapse-button" onClick={() => setCollapsed((value) => !value)}>{collapsed ? <ChevronRight size={16}/> : <ChevronLeft size={16}/>}</button>
      </aside>
      <main className="main-content">{storageFailure && <div className="settings-notice card" role="alert">保存状态异常：{storageFailure}。请保留输入，不要重置数据。</div>}<PageErrorBoundary><Suspense fallback={<div className="page page-loading"><Wheat size={28}/><span>正在加载页面…</span></div>}><PageScrollReset key={page}/>{content}</Suspense></PageErrorBoundary></main>
    </div>
  );
}

function PageScrollReset(){useLayoutEffect(()=>{window.scrollTo({top:0,left:0,behavior:"auto"});const frame=requestAnimationFrame(()=>window.scrollTo({top:0,left:0,behavior:"auto"}));return()=>cancelAnimationFrame(frame);},[]);return null;}
