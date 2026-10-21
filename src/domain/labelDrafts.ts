import { nutrition } from "./calculations";
import { calculateFoodPortion, validateFoodInput } from "./foodLibrary";
import { nutrientKeys, type FoodDefinitionInput, type FoodDefinitionVersion, type FoodUnit, type NutrientKey } from "./types";

export interface LabelDraftForm {
  name: string; brand: string; measurementBasis: FoodDefinitionInput["measurementBasis"];
  basisQuantity: string; basisUnit: FoodUnit; energyUnit: "kcal" | "kJ"; sodiumUnit: "g" | "mg";
  nutrients: Record<NutrientKey, string>;
  conversions: { unit: FoodUnit; quantity: string; basisQuantity: string }[];
  netQuantity: string; netUnit: "g" | "kg" | "ml" | "l"; drainedQuantity: string; drainedUnit: "g" | "kg"; sourceNote: string;
}
export interface LabelDraftSummary {
  id: string; revision: number; status: "draft" | "confirmed" | "discarded";
  name: string | null; sourceReceiptId: string | null; foodId: string | null; updatedAt: string;
}
export interface LabelDraftRecord extends LabelDraftSummary {
  form: LabelDraftForm; sourceArtifactId: string | null; foodVersionId: string | null;
  createdAt: string; sourceName: string | null; sourceMime: string | null; sourceUnavailable: boolean;
}
export const labelReviewItems = { energy: "已核对千焦 kJ / 千卡 kcal", basis: "已核对每 100 克、每份或每包装参考规格", packaging: "已核对包装、净含量和换算；未猜测生熟或密度", unknowns: "已核对空白为未知，只有明确的零填 0" };
export type LabelReview = Record<keyof typeof labelReviewItems, boolean>;
export const emptyLabelReview = (): LabelReview => ({ energy: false, basis: false, packaging: false, unknowns: false });
export const emptyLabelForm = (): LabelDraftForm => ({ name: "", brand: "", measurementBasis: "packaged", basisQuantity: "100", basisUnit: "g", energyUnit: "kJ", sodiumUnit: "mg", nutrients: Object.fromEntries(nutrientKeys.map(k => [k, ""])) as Record<NutrientKey, string>, conversions: [], netQuantity: "", netUnit: "g", drainedQuantity: "", drainedUnit: "g", sourceNote: "" });

function decimal(text: string, field: string, positive = false) {
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(text.trim())) throw new Error(`${field} 请输入明确小数，不接受范围、逗号或文字；未知营养请留空。`);
  const n = Number(text.trim());
  if (!Number.isFinite(n) || n < 0 || (positive && n === 0)) throw new Error(`${field} 数量无效。`);
  return n;
}
export function previewLabel(form: LabelDraftForm) {
  const nutrients: FoodDefinitionInput["nutrients"] = {};
  for (const key of nutrientKeys) if (form.nutrients[key].trim()) nutrients[key] = decimal(form.nutrients[key], key) * (key === "sodium" && form.sodiumUnit === "g" ? 1000 : 1);
  if (!Object.keys(nutrients).length) throw new Error("至少核对一项营养再确认；不完整资料可以先保存草稿。");
  const net = form.netQuantity.trim() ? decimal(form.netQuantity, "净含量", true) : undefined;
  if (form.drainedQuantity.trim()) {
    const drained = decimal(form.drainedQuantity, "沥干物量", true) * (form.drainedUnit === "kg" ? 1000 : 1);
    if (!["g", "kg"].includes(form.netUnit) || net === undefined || drained > net * (form.netUnit === "kg" ? 1000 : 1)) throw new Error("沥干物量需要已知重量净含量，且不能大于净含量；不猜测密度。");
  }
  if (form.sourceNote.length > 1000) throw new Error("来源备注最多 1000 字。");
  const input: FoodDefinitionInput = { name: form.name, brand: form.brand, measurementBasis: form.measurementBasis, basis: { quantity: decimal(form.basisQuantity, "标签参考数量", true), unit: form.basisUnit }, energyUnit: form.energyUnit, nutrients, conversions: form.conversions.map(c => ({ unit: c.unit, quantity: decimal(c.quantity, "换算数量", true), basisQuantity: decimal(c.basisQuantity, "对应参考数量", true) })), source: "label" };
  validateFoodInput(input);
  const normalized = { ...nutrients };
  if (normalized.calories !== undefined && form.energyUnit === "kJ") normalized.calories /= 4.184;
  const version: FoodDefinitionVersion = { id: "preview", foodId: "preview", version: 1, basis: input.basis, conversions: input.conversions, energyUnit: input.energyUnit, labelNutrients: nutrients, nutrition: nutrition(normalized, "label"), source: "label", confirmedBy: "", confirmedAt: "" };
  const per100g = version.basis.unit === "g" || version.conversions.some(c => c.unit === "g") ? calculateFoodPortion(version, 100, "g").nutrition : undefined;
  const per100ml = version.basis.unit === "ml" || version.conversions.some(c => c.unit === "ml") ? calculateFoodPortion(version, 100, "ml").nutrition : undefined;
  if ((per100g?.calories.value ?? 0) > 1000) throw new Error("每 100 克能量超过 1000 千卡，请核对千焦／千卡和参考规格；不会自动改单位。");
  return { input, nutrition: version.nutrition, per100g, per100ml };
}
