// 生成自动更新清单 latest.json（发布轮使用）。
//
// 用法：node scripts/make-update-manifest.mjs <版本号> [仓库名]
// 前置：npm run tauri build 已产出 NSIS 安装包与 .sig 签名（tauri.conf.json createUpdaterArtifacts）。
// 输出：src-tauri/target/release/bundle/nsis/latest.json
// URL 约定：发布时资产以 ASCII 名上传到对应 tag（GitHub 禁止同名资产重复上传，脚本只生成不上传）。
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const version = process.argv[2];
const repo = process.argv[3] ?? "qitian-dasheng/fitwise-local";
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  throw new Error("用法: node scripts/make-update-manifest.mjs <semver 版本号> [owner/repo]");
}

const nsisDir = resolve(root, "src-tauri/target/release/bundle/nsis");
if (!existsSync(nsisDir)) throw new Error(`找不到 ${nsisDir}；先跑 npm run tauri build。`);
const exe = readdirSync(nsisDir).find((name) => name.endsWith("-setup.exe"));
if (!exe) throw new Error(`nsis 目录里没有 *-setup.exe：${nsisDir}`);
const sigFile = exe + ".sig";
if (!existsSync(resolve(nsisDir, sigFile))) throw new Error(`缺少签名文件 ${sigFile}；确认 TAURI_SIGNING_PRIVATE_KEY(_PASSWORD) 已设置并重建。`);

const assetName = `FitwiseLocal_${version}_x64-setup.exe`;
const manifest = {
  version,
  notes: `轻衡 ${version}。变更见 https://github.com/${repo}/releases/tag/v${version}`,
  pub_date: new Date().toISOString(),
  platforms: {
    "windows-x86_64": {
      signature: readFileSync(resolve(nsisDir, sigFile), "utf8").trim(),
      url: `https://github.com/${repo}/releases/download/v${version}/${assetName}`,
    },
  },
};
const outPath = resolve(nsisDir, "latest.json");
writeFileSync(outPath, JSON.stringify(manifest, null, 2) + "\n");
console.log(`生成 ${outPath}`);
console.log(`  版本 ${version}；资产名 ${assetName}；发布时把 exe 重命名上传 + latest.json 一并传到 tag v${version}`);
