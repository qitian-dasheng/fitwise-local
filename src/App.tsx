import { ChevronLeft, ChevronRight, Wheat } from "lucide-react";
import { navItems, toolItems, legacyPageTargets } from "./domain/navigation";
import { Component, lazy, Suspense, useEffect, useLayoutEffect, useState, useSyncExternalStore, type ErrorInfo, type ReactNode } from "react";
import { useAppStore } from "./store/appStore";
import { diaryToday } from "./domain/diary";
import { getStorageFailure, subscribeStorageFailure } from "./data/storage";
import { useSilentUpdateCheck } from "./hooks/useSilentUpdateCheck";
import type { MealType } from "./domain/types";

const TodayPage = lazy(() => import("./pages/TodayPage").then((module) => ({ default: module.TodayPage })));
const FoodPage = lazy(() => import("./pages/FoodPage").then((module) => ({ default: module.FoodPage })));
const BodyPage = lazy(() => import("./pages/BodyPage").then((module) => ({ default: module.BodyPage })));
const WorkoutPage = lazy(() => import("./pages/WorkoutPage").then((module) => ({ default: module.WorkoutPage })));
const TrendsPage = lazy(() => import("./pages/TrendsPage").then((module) => ({ default: module.TrendsPage })));
const SettingsPage = lazy(() => import("./pages/SettingsPage").then((module) => ({ default: module.SettingsPage })));
const FoodLibraryPage = lazy(() => import("./pages/FoodLibraryPage").then((module) => ({ default: module.FoodLibraryPage })));



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
  // 今日页「补记一笔」的直达意图：切到目标页后自动打开对应表单，用完即清。
  const [quick, setQuick] = useState<null | "food" | "workout">(null);
  // 「吃了什么」带来的餐次：表单开在真正待记的那一餐，而不是固定早餐。
  const [quickMeal, setQuickMeal] = useState<MealType>("breakfast");
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
  const profile = useAppStore((state) => state.profile);
  const hydrated = useAppStore.persist.hasHydrated();
  const storageFailure = useSyncExternalStore(subscribeStorageFailure, getStorageFailure);
  const [, forceRender] = useState(0);
  // 启动静默检查更新（设置页可关）：失败静默，绝不因更新打扰记录。
  useSilentUpdateCheck();
  useEffect(() => useAppStore.persist.onFinishHydration(() => forceRender((value) => value + 1)), []);
  useLayoutEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [page]);
  // 深链：#food/#body/... 直达对应页面（截图守卫与分享链接都用）。
  useEffect(() => {
    const applyHash = () => {
      const hash = window.location.hash.replace("#", "");
      if (!hash) return;
      const known = [...navItems, ...toolItems].some((item) => item.id === hash);
      if (known) setPage(legacyPageTargets[hash] ?? hash);
    };
    applyHash();
    window.addEventListener("hashchange", applyHash);
    return () => window.removeEventListener("hashchange", applyHash);
  }, []);
  // 兜底：万一还有旧代码往 trends 跳，先落到它现在所属的页面。
  const active = legacyPageTargets[page] ?? page;
  const content = {
    today: (
      <TodayPage
        goTo={setPage}
        date={date}
        onDateChange={setDate}
        onQuickAction={(kind, mealType) => {
          if (kind === "body") { setPage("body"); return; }
          if (mealType) setQuickMeal(mealType);
          setPage(kind);
          setQuick(kind);
        }}
      />
    ),
    food: (
      <div className="page-stack">
        <FoodPage
          date={date}
          onDateChange={setDate}
          goTo={setPage}
          autoOpenMeal={quick === "food"}
          autoOpenMealType={quickMeal}
          onAutoOpenConsumed={() => setQuick(null)}
        />
      </div>
    ),
    body: (
      <div className="page-stack">
        <BodyPage date={date} onDateChange={setDate} />
        <TrendsPage date={date} onDateChange={setDate} goTo={setPage} embedded />
      </div>
    ),
    workout: (
      <WorkoutPage
        date={date}
        onDateChange={setDate}
        autoOpen={quick === "workout"}
        onAutoOpenConsumed={() => setQuick(null)}
      />
    ),
    settings: <SettingsPage />,
    library: <FoodLibraryPage goTo={setPage} />,
  }[active] ?? <TodayPage goTo={setPage} />;

  if (!hydrated) return <div className="loading-screen"><Wheat size={34}/><strong>{storageFailure ? "本地记录未能安全打开" : "正在打开轻衡…"}</strong>{storageFailure && <><p role="alert">{storageFailure}</p><p>未改用演示数据。请保留当前窗口，不要重置或清理应用数据。</p></>}</div>;

  return (
    <div className={`app-shell ${collapsed ? "sidebar-collapsed" : ""}`}>
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark"><Wheat size={22}/></div><div><strong>轻衡</strong><span>Fitwise Local</span></div></div>
        <nav>
          {navItems.map((item) => <button key={item.id} className={page === item.id ? "active" : ""} onClick={() => setPage(item.id)} title={item.label}><item.icon size={19}/><span>{item.label}</span></button>)}
          <div className="nav-tool-label">工具</div>
          {toolItems.map((item) => <button key={item.id} className={page === item.id ? "active" : ""} onClick={() => setPage(item.id)} title={item.label}><item.icon size={19}/><span>{item.label}</span></button>)}
        </nav>
        <div className="sidebar-bottom"><div className="profile-mini"><div>{profile.name.slice(0, 1)}</div><span><strong>{profile.name}</strong><small>本地账户</small></span></div></div>
        <button className="collapse-button" onClick={() => setCollapsed((value) => !value)}>{collapsed ? <ChevronRight size={16}/> : <ChevronLeft size={16}/>}</button>
      </aside>
      <main className="main-content">{storageFailure && <div className="settings-notice card" role="alert">保存状态异常：{storageFailure}。请保留输入，不要重置数据。</div>}<PageErrorBoundary><Suspense fallback={<div className="page page-loading"><Wheat size={28}/><span>正在加载页面…</span></div>}><PageScrollReset key={page}/>{content}</Suspense></PageErrorBoundary></main>
    </div>
  );
}

function PageScrollReset(){useLayoutEffect(()=>{window.scrollTo({top:0,left:0,behavior:"auto"});const frame=requestAnimationFrame(()=>window.scrollTo({top:0,left:0,behavior:"auto"}));return()=>cancelAnimationFrame(frame);},[]);return null;}
