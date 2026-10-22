/**
 * AI 菜单草稿的前端侧类型与轻校验。
 *
 * 职责边界（与 Rust 侧 menu_drafts.rs 对应）：
 * - 前端只做「能不能解析、必填在不在、数值是不是数」的把关，让用户在粘贴后立刻看到问题；
 * - 三项营养校验（Atwater / NRV% / 规格量级）只在 Rust 侧导入时统一执行，前端不重复算，
 *   避免两套口径。
 */

export interface MenuDraftItemPayload {
  name: string;
  basisQuantity: number;
  basisUnit: string;
  energyUnit?: "kcal" | "kJ";
  /** 键 = 营养项目（calories/protein/carbohydrates/fat/fiber/sugar/sodium），值 = 每「参考数量」的含量。 */
  nutrients?: Record<string, number>;
  /** 标签 NRV%（可空），键同上，值 = 百分比数字（不是字符串）。 */
  nrv?: Record<string, number>;
}

export interface MenuDraftPayload {
  date: string;
  title: string;
  description?: string;
  caloriesKcal: number;
  proteinG: number;
  fiberG?: number;
  estimatedCostCny?: number;
  cookingMinutes?: number;
  inventoryCoverage?: number;
  missingIngredients?: string[];
  reasons?: string[];
  items: MenuDraftItemPayload[];
}

const NUTRIENT_KEYS = ["calories", "protein", "carbohydrates", "fat", "fiber", "sugar", "sodium"] as const;
const BASIS_UNITS = ["g", "ml", "piece", "serving", "package"] as const;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** 给用户复制给外部 AI 的格式说明：草稿长什么样、营养用什么口径。 */
export const menuDraftFormatExample = `{
  "date": "2026-10-23",
  "title": "标准锅日",
  "description": "一句话说明这套菜单的思路",
  "caloriesKcal": 2015,
  "proteinG": 160,
  "fiberG": 12,
  "estimatedCostCny": 18.5,
  "cookingMinutes": 30,
  "inventoryCoverage": 90,
  "missingIngredients": ["白菜"],
  "reasons": ["为什么推荐这套"],
  "items": [
    {
      "name": "白菜豆腐炖里脊",
      "basisQuantity": 100,
      "basisUnit": "g",
      "energyUnit": "kcal",
      "nutrients": { "calories": 120, "protein": 15, "carbohydrates": 5, "fat": 4, "fiber": 1.2, "sugar": 1, "sodium": 300 },
      "nrv": { "protein": 25 }
    }
  ]
}`;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function checkItem(item: unknown, index: number): MenuDraftItemPayload {
  if (!item || typeof item !== "object") throw new Error(`第 ${index + 1} 条菜目不是对象。`);
  const raw = item as Record<string, unknown>;
  const name = raw.name;
  if (typeof name !== "string" || !name.trim()) throw new Error(`第 ${index + 1} 条菜目缺少名称。`);
  if (!isFiniteNumber(raw.basisQuantity) || raw.basisQuantity <= 0) {
    throw new Error(`菜目「${name}」的 basisQuantity 须为正数（每多少克/毫升/份）。`);
  }
  if (typeof raw.basisUnit !== "string" || !BASIS_UNITS.includes(raw.basisUnit as (typeof BASIS_UNITS)[number])) {
    throw new Error(`菜目「${name}」的 basisUnit 须为 ${BASIS_UNITS.join(" / ")} 之一。`);
  }
  if (raw.energyUnit !== undefined && !["kcal", "kJ"].includes(raw.energyUnit as string)) {
    throw new Error(`菜目「${name}」的 energyUnit 须为 kcal 或 kJ。`);
  }
  if (raw.nutrients !== undefined) {
    if (typeof raw.nutrients !== "object" || raw.nutrients === null) {
      throw new Error(`菜目「${name}」的 nutrients 须为对象。`);
    }
    for (const [key, value] of Object.entries(raw.nutrients as Record<string, unknown>)) {
      if (!NUTRIENT_KEYS.includes(key as (typeof NUTRIENT_KEYS)[number])) {
        throw new Error(`菜目「${name}」的营养项目 ${key} 不在 ${NUTRIENT_KEYS.join(" / ")} 中。`);
      }
      if (!isFiniteNumber(value) || value < 0) {
        throw new Error(`菜目「${name}」的营养值 ${key} 须为非负数字。`);
      }
    }
  }
  if (raw.nrv !== undefined) {
    if (typeof raw.nrv !== "object" || raw.nrv === null) {
      throw new Error(`菜目「${name}」的 nrv 须为对象。`);
    }
    for (const [key, value] of Object.entries(raw.nrv as Record<string, unknown>)) {
      if (!NUTRIENT_KEYS.includes(key as (typeof NUTRIENT_KEYS)[number])) {
        throw new Error(`菜目「${name}」的 NRV% 项目 ${key} 无效。`);
      }
      if (!isFiniteNumber(value) || value < 0) {
        throw new Error(`菜目「${name}」的 NRV% ${key} 须为非负数字。`);
      }
    }
  }
  return item as MenuDraftItemPayload;
}

/** 粘贴内容的轻校验：只保证结构可解析、必填在位；营养校验交给 Rust 导入时统一执行。 */
export function validateMenuDraftPayload(text: string): MenuDraftPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("不是有效的 JSON。请把外部 AI 输出的草稿 JSON 完整粘贴进来。");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("草稿须为 JSON 对象。");
  }
  const raw = parsed as Record<string, unknown>;
  if (typeof raw.date !== "string" || !ISO_DATE.test(raw.date)) {
    throw new Error("草稿缺少合法的 date（YYYY-MM-DD）。");
  }
  if (typeof raw.title !== "string" || !raw.title.trim()) {
    throw new Error("草稿缺少 title（方案标题）。");
  }
  if (!isFiniteNumber(raw.caloriesKcal) || raw.caloriesKcal < 0) {
    throw new Error("草稿缺少 caloriesKcal（全天热量，数字）。");
  }
  if (!isFiniteNumber(raw.proteinG) || raw.proteinG < 0) {
    throw new Error("草稿缺少 proteinG（全天蛋白，数字）。");
  }
  if (!Array.isArray(raw.items) || raw.items.length === 0) {
    throw new Error("草稿缺少 items（至少一条菜目）。");
  }
  const items = raw.items.map(checkItem);
  return { ...(raw as unknown as MenuDraftPayload), items };
}
