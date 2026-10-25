/**
 * 下载 USDA FoodData Central SR Legacy 全量数据包（12.5MB，公有领域，无需 API key）。
 * 用法：node scripts/build-food-catalog/fetch-dataset.mjs
 */
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const zipPath = resolve(here, "sr-legacy.zip");
const extractDir = resolve(here, "sr-legacy");
const url = "https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_sr_legacy_food_json_2021-10-28.zip";

if (existsSync(resolve(extractDir, "FoodData_Central_sr_legacy_food_json_2021-10-28.json"))) {
  console.log("数据包已就绪，跳过下载。");
  process.exit(0);
}
console.log("下载", url);
execSync(`curl -fL -o "${zipPath}" "${url}"`, { stdio: "inherit" });
console.log("解压…");
execSync(`unzip -o -q "${zipPath}" -d "${extractDir}"`, { stdio: "inherit" });
console.log("完成。");
