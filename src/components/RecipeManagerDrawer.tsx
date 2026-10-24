import { useMemo, useState } from "react";
import { Copy, PencilLine, Plus, Search, UtensilsCrossed } from "lucide-react";
import type { RecipeVersion } from "../domain/types";
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
  // R4-A：名称搜索 + 轻量排序，只做查找面，不动菜谱数据模型。
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = options.filter((item) => !needle || item.name.toLowerCase().includes(needle));
    return [...filtered].sort((left, right) =>
      sort === "name" ? left.name.localeCompare(right.name, "zh-Hans-CN") : right.createdAt.localeCompare(left.createdAt),
    );
  }, [options, query, sort]);
  function changeQuery(value: string) {
    setQuery(value);
    // 当前选择被搜掉时跟到第一个匹配，避免摘要区与下拉脱节。
    const needle = value.trim().toLowerCase();
    if (recipe && !recipe.name.toLowerCase().includes(needle)) {
      const first = options.find((item) => !needle || item.name.toLowerCase().includes(needle));
      onSelect(first?.id ?? "");
    }
  }

  return (
    <Drawer title="管理菜谱" eyebrow="标准菜谱" onClose={onClose}>
      <div className="button-row">
        <button className="button secondary" onClick={onNew}>
          <Plus size={15} /> 新建菜谱
        </button>
        <button className="button secondary" disabled={!recipe || !isLatest} onClick={onRevise}>
          <PencilLine size={15} /> 修订当前菜谱
        </button>
        <button className="button secondary" disabled={!recipe} onClick={onCopy}>
          <Copy size={15} /> 另存为新菜谱
        </button>
        <button className="button secondary" disabled={!recipe} onClick={onAddToMeal}>
          <UtensilsCrossed size={15} /> 加入餐次
        </button>
      </div>

      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={showHistory}
          onChange={(event) => onShowHistoryChange(event.target.checked)}
        />
        <span>菜谱管理：显示历史版本（可按原配方制作或另存）</span>
      </label>

      <div className="recipe-finder">
        <label className="recipe-picker-search">
          <Search size={15} />
          <input aria-label="搜索菜谱名称" placeholder="搜索菜谱名称" value={query} onChange={(event) => changeQuery(event.target.value)} />
        </label>
        <div className="recipe-picker-sort">
          <span>排序</span>
          <select aria-label="菜谱排序" value={sort} onChange={(event) => setSort(event.target.value as "name" | "recent")}>
            <option value="name">按名称</option>
            <option value="recent">按创建时间（新→旧）</option>
          </select>
          <small>{visible.length ? `匹配 ${visible.length} 道菜` : "没有匹配的菜谱"}</small>
        </div>
        {visible.length > 0 && (
          <label className="recipe-picker">
            <span>选择标准菜谱（{showHistory ? "含历史版本" : "每道菜的最新版本"}）</span>
            <select aria-label="选择标准菜谱" value={recipe && visible.some((item) => item.id === recipe.id) ? recipe.id : ""} onChange={(event) => onSelect(event.target.value)}>
              {visible.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} · v{item.version}
                  {latest.some((entry) => entry.id === item.id) ? "（最新）" : "（历史）"}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {recipe ? (
        <div className="drawer-summary">
          <p className="eyebrow">当前选择</p>
          <strong>
            {recipe.name} · v{recipe.version}
            {isLatest ? "（最新）" : "（历史）"}
          </strong>
          <span>
            {nutrientText(recipe.nutrition, "calories", energyUnit)} {energyUnitLabels[energyUnit]} · {nutrientText(recipe.nutrition, "protein")} g 蛋白质 ·{" "}
            {recipe.ingredients.length} 种原料 · {recipe.totalMinutes} 分钟
          </span>
          <span>共 {recipes.length} 个版本，其中最新版本 {latest.length} 个。</span>
        </div>
      ) : (
        <div className="drawer-summary">
          <p className="eyebrow">当前选择</p>
          <strong>暂无标准菜谱</strong>
          <span>仍可通过食材库或仅记录本次入口记餐。</span>
        </div>
      )}

      {recipe && !isLatest && (
        <p className="library-notice">
          正在复用历史 v{recipe.version}：制作会沿用此版本的原料和营养，不替换为最新版。修订请先选择最新版，或另存为新菜谱。
        </p>
      )}
    </Drawer>
  );
}
