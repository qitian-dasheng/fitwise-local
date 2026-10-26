/**
 * 食物目录构建脚本（0.11.0）：
 * 1. 下载 USDA FoodData Central SR Legacy 全量包（12.5MB，权威、公有领域）。
 * 2. 按 manifest.json（人工策展：中文名 → FDC 描述键，八大类）提取营养值。
 * 3. 产出 src-tauri/resources/food-catalog.json（编译嵌入二进制）。
 *
 * 纪律：所有数值来自 SR Legacy 数据原文，缺失营养标 unknown，**不做任何推算**；
 * 每条带 sourceRef（库名 + FDC ID + 原文描述）。
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const srPath = resolve(here, "sr-legacy/FoodData_Central_sr_legacy_food_json_2021-10-28.json");
const catalogPath = resolve(here, "../../src-tauri/resources/food-catalog.json");
const NUTRIENT_UNITS = { calories: "kcal", protein: "g", carbohydrates: "g", fat: "g", fiber: "g", sugar: "g", sodium: "mg" };
const CATALOG_VERSION = 2;

if (!existsSync(srPath)) {
  console.error(`缺少 ${srPath}；先运行：node scripts/build-food-catalog/fetch-dataset.mjs`);
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(resolve(here, "manifest.json"), "utf8"));
const data = JSON.parse(readFileSync(srPath, "utf8"));
const byId = new Map(data.SRLegacyFoods.map((item) => [String(item.fdcId), item]));

/**
 * USDA 每个食物带两条 "Energy" 营养（一条 kcal、一条 kJ），仅按名称匹配会随机取到 kJ，
 * 导致能量值虚高约 4.18 倍且单位仍标 kcal。因此能量必须按 unitName 精确锁定 kcal；
 * 只有 kJ 的条目宁可标 unknown，也不做换算（遵守"不做任何推算"）。
 */
const NUTRIENT_MAP = {
  calories: { name: /^energy$/i, unit: "kcal" },
  protein: { name: /^protein$/i },
  carbohydrates: { name: /^carbohydrate, by difference$/i },
  fat: { name: /^total lipid \(fat\)$/i },
  fiber: { name: /^fiber, total dietary$/i },
  sugar: { name: /^sugars, total including nlea$/i },
  sodium: { name: /^sodium, na$/i },
};

function extractNutrients(food) {
  const found = {};
  for (const entry of food.foodNutrients ?? []) {
    const name = entry.nutrient?.name ?? "";
    const unitName = (entry.nutrient?.unitName ?? "").toLowerCase();
    for (const [key, spec] of Object.entries(NUTRIENT_MAP)) {
      if (!spec.name.test(name)) continue;
      if (spec.unit && unitName !== spec.unit) continue;
      if (entry.amount !== null && entry.amount !== undefined) found[key] = entry.amount;
    }
  }
  return found;
}

function nutrientFacts(value, key) {
  const unit = NUTRIENT_UNITS[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return { state: "unknown", unit, source: "official", confidence: "high" };
  }
  return { state: "known", value, unit, source: "official", confidence: "high" };
}

const now = new Date().toISOString();
const items = [];
const warnings = [];

for (const [fdcId, meta] of Object.entries(manifest)) {
  const food = byId.get(fdcId);
  if (!food) { warnings.push(`FDC ${fdcId}（${meta.name}）在数据包中不存在`); continue; }
  const values = extractNutrients(food);
  if (values.calories === undefined) warnings.push(`FDC ${fdcId}（${meta.name}）缺能量值`);

  const catalogId = `fdc-${fdcId}`;
  const definitionId = `catalog-${catalogId}`;
  items.push({
    catalogId,
    category: meta.category,
    name: meta.name,
    sourceRef: { database: "USDA FoodData Central (SR Legacy)", fdcId: Number(fdcId), description: food.description },
    definition: {
      id: definitionId,
      name: meta.name,
      measurementBasis: "edible",
      favorite: false,
    },
    version: {
      id: `${definitionId}:v1`,
      foodId: definitionId,
      version: 1,
      // basis 只允许 quantity / unit：Rust 侧 Basis 是 deny_unknown_fields，
      // measurementBasis 属于 definition 层（可食部口径），写进 basis 会让整个食材库反序列化失败。
      basis: { quantity: 100, unit: "g" },
      conversions: [],
      energyUnit: "kcal",
      labelNutrients: Object.fromEntries(Object.entries(values).filter(([, value]) => typeof value === "number")),
      nutrition: Object.fromEntries(Object.keys(NUTRIENT_UNITS).map((key) => [key, nutrientFacts(values[key], key)])),
      source: "official",
      confirmedBy: "内置目录",
      confirmedAt: now,
    },
  });
}

/**
 * 形状守卫：Rust 侧 Basis 是 deny_unknown_fields，只接受 quantity / unit。
 * 历史上 basis 里多写了一个 measurementBasis，导致食材库整页反序列化报错，
 * 这里在构建期直接拦住。
 */
for (const item of items) {
  const keys = Object.keys(item.version.basis).sort().join(",");
  if (keys !== "quantity,unit") {
    throw new Error(`basis 形状非法（${keys}）：${item.name}；只允许 quantity,unit`);
  }
  if (item.definition.measurementBasis !== "edible") {
    throw new Error(`definition 缺少 measurementBasis=edible：${item.name}`);
  }
}

const categories = {};
for (const item of items) categories[item.category] = (categories[item.category] ?? 0) + 1;

/**
 * 能量单位回归守卫：USDA 同时给 kcal 与 kJ 两条 Energy，取错会让数值虚高约 4.18 倍。
 * 用已知条目区间 + 非油脂上限双重断言，构建期就失败，而不是等到用户看到离谱热量。
 */
const ENERGY_SANITY = { 鸡蛋: [130, 160], 全脂牛奶: [50, 75], 橄榄油: [860, 910], 香蕉: [80, 100] };
for (const [name, [low, high]] of Object.entries(ENERGY_SANITY)) {
  const item = items.find((entry) => entry.name === name);
  if (!item) throw new Error(`能量守卫：目录缺少样例条目「${name}」`);
  const value = item.version.nutrition.calories.value;
  if (typeof value !== "number" || value < low || value > high) {
    throw new Error(`能量守卫失败：「${name}」为 ${value} kcal，超出 [${low}, ${high}]，疑似把 kJ 当成 kcal。`);
  }
}
const outliers = items.filter(
  (item) => item.category !== "油脂调味" && item.version.nutrition.calories.value > 950,
);
if (outliers.length) {
  throw new Error(
    `能量守卫：非油脂条目能量异常偏高（疑似 kJ）：${outliers.map((item) => `${item.name}=${item.version.nutrition.calories.value}`).join("、")}`,
  );
}

mkdirSync(dirname(catalogPath), { recursive: true });
writeFileSync(catalogPath, JSON.stringify({ catalogVersion: CATALOG_VERSION, generatedAt: now, dataSource: "USDA FoodData Central SR Legacy（公有领域）", items }, null, 1) + "\n");
console.log(`生成 ${catalogPath}`);
console.log(`条目 ${items.length}；分类分布:`, JSON.stringify(categories));
if (warnings.length) { console.log("警告:"); for (const warning of warnings) console.log(" -", warning); }
