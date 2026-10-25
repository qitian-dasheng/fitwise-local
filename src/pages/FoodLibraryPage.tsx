import { useEffect, useState } from "react";
import { Archive, ArchiveRestore, ArrowLeft, PencilLine, Plus, Search, Star, Trash2, Type, UtensilsCrossed } from "lucide-react";
import { useFoodLibrarySearch } from "../data/foodLibrary";
import { findFoodItem, foodBasisLabels, foodUnitLabels, nutrientLabel } from "../domain/foodLibrary";
import type { FoodLibraryItem } from "../domain/types";
import { useAppStore } from "../store/appStore";
import { useFoodPicker } from "../store/foodPicker";
import { useConfirmedAction } from "../components/useConfirmedAction";
import { FoodEditor, FoodIdentityEditor } from "../components/FoodEditor";
import { PantryPanel } from "../components/PantryPanel";
import { useEnergyUnit } from "../hooks/useEnergyUnit";
import { energyUnitLabels } from "../domain/energyDisplay";

/**
 * 食材库独立页：搜索/筛选 + 行内管理（修订、收藏、归档、纠错、删除）+ 全页建档表单。
 * 工具页不受五主页面一屏化约束，可正常滚动；选择器（记餐弹窗）只负责“选”，建档与管理都在这里。
 */
export function FoodLibraryPage({ goTo }: { goTo?: (page: string) => void } = {}) {
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"all" | "recent" | "favorites" | "archived" | "pantry">("all");
  const [editing, setEditing] = useState<FoodLibraryItem | "new" | null>(null);
  const [identity, setIdentity] = useState<FoodLibraryItem | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [fromPicker, setFromPicker] = useState(false);
  const search = useFoodLibrarySearch(query, mode);
  const action = useConfirmedAction();
  const state = useAppStore();
  const returnTicket = useFoodPicker((picker) => picker.returnTicket);
  const [displayUnit] = useEnergyUnit();

  // 饮食页转来的建档/修订意图：挂载即打开对应编辑器，并记住“要回记餐”。
  useEffect(() => {
    const target = useFoodPicker.getState().editorTarget;
    if (target) {
      setEditing(target);
      setFromPicker(true);
      useFoodPicker.getState().setEditorTarget(null);
    }
  }, []);

  if (editing) {
    const savedName = editing === "new" ? "" : editing.definition.name;
    return (
      <div className="page food-library-page">
        <header className="ui-page-head">
          <div>
            <div className="date">营养资料 · 保存不记餐 · 留空是未知，明确填 0 才是零</div>
            <h1>{editing === "new" ? "新建食物" : `修订 ${savedName}`}</h1>
          </div>
          <div className="actions" style={{ display: "flex", gap: 8 }}>
            <button className="ui-btn" onClick={() => { action.setMessage(""); setEditing(null); }}><ArrowLeft size={15}/> 返回食材库</button>
          </div>
        </header>
        {fromPicker && <p className="library-notice">从记餐转来：保存后可一键返回饮食页，待确认篮子仍在。</p>}
        <section className="card editor-card">
          <FoodEditor
            key={editing === "new" ? "new" : editing.version.id}
            item={editing === "new" ? undefined : editing}
            action={action}
            layout="page"
            onCancel={() => { action.setMessage(""); setEditing(null); setFromPicker(false); }}
            onSaved={(foodId) => {
              setEditing(null);
              const saved = findFoodItem(useAppStore.getState(), foodId);
              // 与旧弹窗同口径：修订使旧版本失效，篮子里该食物的旧版本条目一并移除。
              const staleVersionIds = new Set(useAppStore.getState().foodDefinitionVersions.filter((version) => version.foodId === foodId && saved && version.id !== saved.version.id).map((version) => version.id));
              useFoodPicker.getState().setBasket((items) => items.filter((entry) => !staleVersionIds.has(entry.foodVersionId)));
              if (fromPicker) {
                useFoodPicker.getState().setReturnTicket(foodId);
                setNotice("营养资料已保存。");
                setFromPicker(false);
              } else {
                setNotice(`已保存「${saved?.definition.name ?? "食物"}」的资料。`);
                setMode("all");
                setQuery("");
              }
            }}
          />
        </section>
        {returnTicket && goTo && (
          <button className="button primary" onClick={() => goTo("food")}><UtensilsCrossed size={15}/> 返回记餐（篮子已保留）</button>
        )}
        {notice && <p className="library-notice" role="status">{notice}</p>}
      </div>
    );
  }

  if (identity) {
    return (
      <div className="page food-library-page">
        <header className="ui-page-head">
          <div>
            <div className="date">营养资料 · 纠错 · 只更正名称与品牌，营养规格与历史记录不被改写</div>
            <h1>纠错 {identity.definition.name}</h1>
          </div>
          <div className="actions" style={{ display: "flex", gap: 8 }}>
            <button className="ui-btn" onClick={() => { action.setMessage(""); setIdentity(null); }}><ArrowLeft size={15}/> 返回食材库</button>
          </div>
        </header>
        <section className="card editor-card">
          <FoodIdentityEditor
            item={identity}
            action={action}
            onCancel={() => { action.setMessage(""); setIdentity(null); }}
            onSaved={() => { setIdentity(null); setNotice("名称/品牌已纠错。营养规格与历史记录未改动。"); }}
          />
        </section>
        {notice && <p className="library-notice" role="status">{notice}</p>}
      </div>
    );
  }

  return (
    <div className="page food-library-page">
      <header className="ui-page-head">
        <div>
          <div className="date">营养资料 · 本地资产库 · 一次建档、长期复用；修订生成新版本，未被引用可删</div>
          <h1>食材库</h1>
        </div>
        <div className="actions" style={{ display: "flex", gap: 8 }}>
          {returnTicket && goTo && <button className="ui-btn" onClick={() => goTo("food")}><UtensilsCrossed size={15}/> 返回记餐（篮子已保留）</button>}
          <button className="ui-btn primary" onClick={() => { action.setMessage(""); setEditing("new"); }}><Plus size={16}/> 新建食物</button>
        </div>
      </header>
      {notice && <p className="library-notice" role="status">{notice}</p>}
      {mode !== "pantry" && (
        <div className="library-toolbar">
          <label className="library-search"><Search size={17}/><input aria-label="搜索食物或品牌" placeholder="搜索食物名称或品牌" value={query} onChange={(event) => setQuery(event.target.value)}/></label>
        </div>
      )}
      <div className="library-tabs" role="group" aria-label="食材筛选">
        {([["all", "全部"], ["recent", "最近使用"], ["favorites", "常用收藏"], ["archived", "已归档"], ["pantry", "食物柜"]] as const).map(([value, label]) => (
          <button key={value} className={mode === value ? "active" : ""} onClick={() => { setMode(value); setPendingDelete(null); }}>{label}</button>
        ))}
      </div>
      {mode === "pantry" ? <PantryPanel/> : (<>
      {search.error && <p className="form-error" role="alert">{search.error}</p>}
      <div className="library-body library-page-body">
        <div className="library-results">
          {search.loading ? <p className="form-hint">正在读取食材库…</p> : search.items.length ? search.items.map((item) => (
            <div key={item.definition.id}>
              <div className="library-item">
                <div className="library-select">
                  <strong>{item.definition.name}</strong>
                  <span>{item.definition.brand || "无品牌"} · {foodBasisLabels[item.definition.measurementBasis]}</span>
                  <small>每 {item.version.basis.quantity}{foodUnitLabels[item.version.basis.unit]} · {nutrientLabel(item.version.nutrition, "calories", 1, displayUnit)} {energyUnitLabels[displayUnit]} · v{item.version.version}</small>
                </div>
                <span className="library-item-actions">
                  <button className={`icon-button ${item.definition.favorite ? "favorite" : ""}`} aria-label={`${item.definition.favorite ? "取消收藏" : "收藏"}${item.definition.name}`} disabled={action.busy} onClick={() => { void action.run(`favorite:${item.definition.id}:${!item.definition.favorite}`, (id) => state.setFoodFavorite(item.definition.id, !item.definition.favorite, id)); }}><Star size={17} fill={item.definition.favorite ? "currentColor" : "none"}/></button>
                  <button className="icon-button" aria-label={`修订${item.definition.name}的营养规格`} title="修订营养规格（生成新版本）" disabled={action.busy} onClick={() => { action.setMessage(""); setPendingDelete(null); setEditing(item); }}><PencilLine size={16}/></button>
                  <button className={`icon-button ${item.definition.archived ? "favorite" : ""}`} aria-label={`${item.definition.archived ? "取消归档" : "归档"}${item.definition.name}`} title={item.definition.archived ? "取消归档后重新出现在日常挑选" : "归档后从日常挑选隐藏，历史记录不受影响"} disabled={action.busy} onClick={() => { const archived = item.definition.archived === true; void action.run(`archive:${item.definition.id}:${!archived}`, async (id) => { const result = await state.setFoodArchived(item.definition.id, !archived, id); if (!result.error) setNotice(archived ? `已取消归档「${item.definition.name}」。` : `已归档「${item.definition.name}」，日常挑选将不再显示。`); return result; }); }}>{item.definition.archived ? <ArchiveRestore size={16}/> : <Archive size={16}/>}</button>
                  <button className="icon-button" aria-label={`纠错${item.definition.name}的名称或品牌`} title="纠错名称/品牌（未引用食材）" disabled={action.busy} onClick={() => { action.setMessage(""); setPendingDelete(null); setIdentity(item); }}><Type size={16}/></button>
                  <button className="icon-button" aria-label={`永久删除${item.definition.name}`} title="永久删除（仅无引用食材）" disabled={action.busy} onClick={() => { action.setMessage(""); setPendingDelete(item.definition.id); }}><Trash2 size={16}/></button>
                </span>
              </div>
              {pendingDelete === item.definition.id && (
                <div className="delete-confirm" role="alert">
                  <strong>永久删除「{item.definition.name}」？</strong>
                  <span>仅当没有任何餐食或菜谱引用时才允许删除。删除后可在导出 JSON 的审计记录中找到完整内容手工恢复，但没有一键恢复。</span>
                  <div className="button-row">
                    <button className="button danger small" disabled={action.busy} onClick={() => { void action.run(`delete:${item.definition.id}`, async (id) => { const result = await state.deleteFood(item.definition.id, id); if (!result.error) { setPendingDelete(null); setNotice(`已永久删除「${item.definition.name}」。`); } return result; }); }}>确认永久删除</button>
                    <button className="button secondary small" disabled={action.busy} onClick={() => setPendingDelete(null)}>取消</button>
                  </div>
                </div>
              )}
            </div>
          )) : (
            <div className="library-empty">
              <strong>{mode === "recent" ? "尚无食材库记餐记录" : mode === "favorites" ? "还没有收藏食物" : mode === "archived" ? "没有已归档的食材" : query ? "没有找到食物" : "食材库还是空的"}</strong>
              <p>新食物先保存一次规格，之后记餐时就可以直接选择。</p>
              <button className="button secondary small" onClick={() => setEditing("new")}>新建食物</button>
            </div>
          )}
        </div>
      </div>
      <p className="form-hint">这里只管理营养资料，不写入饮食；记餐请到「饮食」页。</p>
      </>)}
    </div>
  );
}
