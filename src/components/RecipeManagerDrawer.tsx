import { useMemo, useState } from "react";
import { Copy, PencilLine, Plus, Search, UtensilsCrossed } from "lucide-react";
import type { MealType, RecipeVersion } from "../domain/types";
import { mealLabels, mealTypes } from "../domain/meals";
import { Drawer } from "./Drawer";
import { useEnergyUnit } from "../hooks/useEnergyUnit";
import { energyUnitLabels } from "../domain/energyDisplay";
import { nutrientText } from "../domain/nutritionDisplay";

interface RecipeManagerDrawerProps {
  /** 全部菜谱版本（含历史）。 */
  recipes: RecipeVersion[];
  /** 每道菜的最新版本。 */
  latest: RecipeVersion[];
  /** 按 showHistory 过滤后可选版本。 */
  options: RecipeVersion[];
  recipe?: RecipeVersion;
  showHistory: boolean;
  onShowHistoryChange: (visible: boolean) => void;
  onSelect: (id: string) => void;
  onNew: () => void;
  /** 仅在当前选中最新版本时可用。 */
  onRevise: () => void;
  onCopy: () => void;
  /** 把当前菜谱按实际份量加入餐次（R1 草稿入口）。 */
  onAddToMeal: () => void;
  onClose: () => void;
}

/**
 * 0.9.4 第三轮重设计：当前选择卡置顶（动作跟随选择），下方为可滚动的菜谱列表
 * （按适用餐次分组、点行即选）——替代原「搜索+排序+原生下拉+底部摘要」的四层堆叠。
 */
export function RecipeManagerDrawer({
  recipes,
  latest,
  options,
  recipe,
  showHistory,
  onShowHistoryChange,
  onSelect,
  onNew,
  onRevise,
  onCopy,
  onAddToMeal,
  onClose,
}: RecipeManagerDrawerProps) {
  const isLatest = recipe ? latest.some((item) => item.id === recipe.id) : false;
  const [energyUnit] = useEnergyUnit();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"name" | "recent">("name");
  // OBS-010（0.9.4）：按适用餐次筛选，多标签菜谱在任一匹配分组出现；未分类兜底。
  const [mealFilter, setMealFilter] = useState<MealType | "unlabeled" | "all">("all");
  const searched = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return options.filter((item) => !needle || item.name.toLowerCase().includes(needle));
  }, [options, query]);
  const visible = useMemo(() => {
    const filtered = mealFilter === "all"
      ? searched
      : searched.filter((item) => mealFilter === "unlabeled"
          ? !item.mealTags?.length
          : item.mealTags?.includes(mealFilter));
    return [...filtered].sort((left, right) =>
      sort === "name" ? left.name.localeCompare(right.name, "zh-Hans-CN") : right.createdAt.localeCompare(left.createdAt),
    );
  }, [searched, mealFilter, sort]);
  // 分组：早餐→午餐→晚餐→加餐→未分类；多标签菜谱进每个匹配组。
  const grouped = useMemo<{ type: MealType | "unlabeled"; label: string; items: RecipeVersion[] }[]>(() => {
    const groups: { type: MealType | "unlabeled"; label: string; items: RecipeVersion[] }[] = mealTypes
      .filter((type) => visible.some((item) => item.mealTags?.includes(type)))
      .map((type) => ({ type, label: mealLabels[type], items: visible.filter((item) => item.mealTags?.includes(type)) }));
    const unlabeled = visible.filter((item) => !item.mealTags?.length);
    if (unlabeled.length) groups.push({ type: "unlabeled", label: "未分类", items: unlabeled });
    return groups;
  }, [visible]);

  function changeMealFilter(value: MealType | "unlabeled" | "all") {
    setMealFilter(value);
    // 与名称搜索同口径：当前选择被筛掉时跟到第一个匹配，避免摘要区与列表脱节。
    if (recipe && value !== "all") {
      const matches = (item: RecipeVersion) => value === "unlabeled" ? !item.mealTags?.length : item.mealTags?.includes(value);
      if (!matches(recipe)) {
        const first = searched.find(matches);
        onSelect(first?.id ?? "");
      }
    }
  }
  function changeQuery(value: string) {
    setQuery(value);
    // 当前选择被搜掉时跟到第一个匹配，避免摘要区与列表脱节。
    const needle = value.trim().toLowerCase();
    if (recipe && !recipe.name.toLowerCase().includes(needle)) {
      const first = options.find((item) => !needle || item.name.toLowerCase().includes(needle));
      onSelect(first?.id ?? "");
    }
  }

  return (
    <Drawer title="管理菜谱" eyebrow="标准菜谱" onClose={onClose}>
      <div className="drawer-current">
        {recipe ? (
          <>
            <p className="eyebrow">当前选择</p>
            <strong>{recipe.name} · v{recipe.version}{isLatest ? "" : "（历史）"}</strong>
            <span>
              {nutrientText(recipe.nutrition, "calories", energyUnit)} {energyUnitLabels[energyUnit]} · 蛋白 {nutrientText(recipe.nutrition, "protein")} g · {recipe.ingredients.length} 种原料 · {recipe.totalMinutes} 分钟
              {recipe.mealTags?.length ? ` · 适用 ${recipe.mealTags.map((tag) => mealLabels[tag]).join("、")}` : " · 未设适用餐次"}
            </span>
            <div className="button-row">
              <button className="button primary" onClick={onAddToMeal}><UtensilsCrossed size={15} /> 加入餐次</button>
              <button className="button secondary" disabled={!isLatest} onClick={onRevise}><PencilLine size={15} /> 修订</button>
              <button className="button secondary" onClick={onCopy}><Copy size={15} /> 另存</button>
            </div>
            {!isLatest && <p className="library-notice">正在复用历史版本：加入餐次沿用此配方；修订请选最新版，或另存为新菜谱。</p>}
          </>
        ) : (
          <>
            <p className="eyebrow">当前选择</p>
            <strong>暂无菜谱</strong>
            <span>固定搭配建成菜谱后，可一键按份量记入餐次。</span>
          </>
        )}
      </div>

      <div className="recipe-list-tools">
        <label className="recipe-picker-search">
          <Search size={15} />
          <input aria-label="搜索菜谱名称" placeholder="搜索菜谱名称" value={query} onChange={(event) => changeQuery(event.target.value)} />
        </label>
        <div className="recipe-filter-row">
          <select aria-label="按餐次筛选" value={mealFilter} onChange={(event) => changeMealFilter(event.target.value as MealType | "unlabeled" | "all")}>
            <option value="all">全部餐次</option>
            {mealTypes.map((type) => <option key={type} value={type}>{mealLabels[type]}</option>)}
            <option value="unlabeled">未分类</option>
          </select>
          <select aria-label="菜谱排序" value={sort} onChange={(event) => setSort(event.target.value as "name" | "recent")}>
            <option value="name">按名称</option>
            <option value="recent">按时间</option>
          </select>
          <label className="checkbox-label recipe-history-toggle">
            <input type="checkbox" checked={showHistory} onChange={(event) => onShowHistoryChange(event.target.checked)} />
            <span>历史版本</span>
          </label>
        </div>
        <small className="recipe-list-count">{visible.length ? `匹配 ${visible.length} 道菜` : "没有匹配的菜谱"}</small>
      </div>

      <div className="recipe-list" role="listbox" aria-label="选择标准菜谱">
        {grouped.map((group) => (
          <div key={group.type} role="presentation">
            <p className="recipe-list-group">{group.label}</p>
            {group.items.map((item) => (
              <button
                key={item.id}
                role="option"
                aria-selected={recipe?.id === item.id}
                className={`recipe-list-item${recipe?.id === item.id ? " active" : ""}`}
                onClick={() => onSelect(item.id)}
              >
                <span className="recipe-list-item-main">
                  <strong>{item.name}</strong>
                  <small>v{item.version} · {nutrientText(item.nutrition, "calories", energyUnit)} {energyUnitLabels[energyUnit]} · {item.totalMinutes} 分钟</small>
                </span>
                {latest.some((entry) => entry.id === item.id)
                  ? <span className="ui-badge ok">最新</span>
                  : <span className="ui-badge flat">历史</span>}
              </button>
            ))}
          </div>
        ))}
        {visible.length === 0 && <p className="form-hint">没有匹配的菜谱。换个关键词、放宽餐次筛选，或勾选历史版本。</p>}
      </div>

      <button className="button secondary wide" onClick={onNew}><Plus size={15} /> 新建菜谱</button>
      <small className="recipe-list-count">共 {recipes.length} 个版本，其中最新 {latest.length} 个。</small>
    </Drawer>
  );
}
