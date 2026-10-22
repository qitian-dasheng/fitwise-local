import { Copy, Plus, PencilLine } from "lucide-react";
import type { RecipeVersion } from "../domain/types";
import { Drawer } from "./Drawer";
import { useEnergyUnit } from "../hooks/useEnergyUnit";
import { energyUnitLabels, toDisplayEnergyMaybe } from "../domain/energyDisplay";

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
  onClose,
}: RecipeManagerDrawerProps) {
  const isLatest = recipe ? latest.some((item) => item.id === recipe.id) : false;
  const [energyUnit] = useEnergyUnit();

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
      </div>

      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={showHistory}
          onChange={(event) => onShowHistoryChange(event.target.checked)}
        />
        <span>菜谱管理：显示历史版本（可按原配方制作或另存）</span>
      </label>

      {options.length > 0 && (
        <label className="recipe-picker">
          <span>选择标准菜谱（{showHistory ? "含历史版本" : "每道菜的最新版本"}）</span>
          <select aria-label="选择标准菜谱" value={recipe?.id ?? ""} onChange={(event) => onSelect(event.target.value)}>
            {options.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} · v{item.version}
                {latest.some((entry) => entry.id === item.id) ? "（最新）" : "（历史）"}
              </option>
            ))}
          </select>
        </label>
      )}

      {recipe ? (
        <div className="drawer-summary">
          <p className="eyebrow">当前选择</p>
          <strong>
            {recipe.name} · v{recipe.version}
            {isLatest ? "（最新）" : "（历史）"}
          </strong>
          <span>
            {toDisplayEnergyMaybe(recipe.nutrition.calories.value, energyUnit) ?? "未知"} {energyUnitLabels[energyUnit]} · {recipe.nutrition.protein.value ?? "未知"} g 蛋白质 ·{" "}
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
