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
const CATALOG_VERSION = 1;

if (!existsSync(srPath)) {
  console.error(`缺少 ${srPath}；先运行：node scripts/build-food-catalog/fetch-dataset.mjs`);
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(resolve(here, "manifest.json"), "utf8"));
const data = JSON.parse(readFileSync(srPath, "utf8"));
const byId = new Map(data.SRLegacyFoods.map((item) => [String(item.fdcId), item]));

const NUTRIENT_MAP = {
  calories: /^energy$/i,
  protein: /^protein$/i,
  carbohydrates: /^carbohydrate, by difference$/i,
  fat: /^total lipid \(fat\)$/i,
  fiber: /^fiber, total dietary$/i,
  sugar: /^sugars, total including nlea$/i,
  sodium: /^sodium, na$/i,
};

function extractNutrients(food) {
  const found = {};
  for (const entry of food.foodNutrients ?? []) {
    const name = entry.nutrient?.name ?? "";
    for (const [key, regex] of Object.entries(NUTRIENT_MAP)) {
      if (regex.test(name) && entry.amount !== null && entry.amount !== undefined) found[key] = entry.amount;
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
      basis: { quantity: 100, unit: "g", measurementBasis: "edible" },
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

const categories = {};
for (const item of items) categories[item.category] = (categories[item.category] ?? 0) + 1;

mkdirSync(dirname(catalogPath), { recursive: true });
writeFileSync(catalogPath, JSON.stringify({ catalogVersion: CATALOG_VERSION, generatedAt: now, dataSource: "USDA FoodData Central SR Legacy（公有领域）", items }, null, 1) + "\n");
console.log(`生成 ${catalogPath}`);
console.log(`条目 ${items.length}；分类分布:`, JSON.stringify(categories));
if (warnings.length) { console.log("警告:"); for (const warning of warnings) console.log(" -", warning); }
