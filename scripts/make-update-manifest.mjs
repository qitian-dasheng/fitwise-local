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
// 只认与目标版本号匹配的安装包。nsis 目录会累积多代产物（0.9.2 起），
// 早期实现用 find() 取目录里第一个 *-setup.exe，结果抓到旧包，
// 导致 latest.json 里混进上一版的签名（0.11.0 发布轮实际踩中：签的是 0.9.3）。
const allExe = readdirSync(nsisDir).filter((name) => name.endsWith("-setup.exe"));
const candidates = allExe.filter((name) => name.includes(version));
if (candidates.length === 0) {
  throw new Error(
    `nsis 目录里没有匹配 ${version} 的 *-setup.exe：${nsisDir}\n现有：${allExe.join("、") || "(空)"}`,
  );
}
if (candidates.length > 1) {
  throw new Error(`匹配 ${version} 的安装包不止一个，无法确定签名对象：${candidates.join("、")}`);
}
const exe = candidates[0];
const sigFile = exe + ".sig";
const sigPath = resolve(nsisDir, sigFile);
if (!existsSync(sigPath)) throw new Error(`缺少签名文件 ${sigFile}；确认 TAURI_SIGNING_PRIVATE_KEY(_PASSWORD) 已设置并重建。`);

// 签名自校验：minisign 的 trusted comment 明文写着 file 与 version，
// 与目标版本不符说明签的不是这个包，直接失败而不是生成一份错清单。
const signature = readFileSync(sigPath, "utf8").trim();
const trustedComment = Buffer.from(signature, "base64").toString("utf8").replace(/\s+/g, " ");
if (!trustedComment.includes(`version:${version}`)) {
  throw new Error(`签名与版本不匹配：${sigFile} 的 trusted comment 中找不到 version:${version}\n实际：${trustedComment.slice(0, 200)}`);
}
if (!trustedComment.includes(exe)) {
  throw new Error(`签名对应的文件名不是 ${exe}\n实际：${trustedComment.slice(0, 200)}`);
}

const assetName = `FitwiseLocal_${version}_x64-setup.exe`;
const manifest = {
  version,
  notes: `轻衡 ${version}。变更见 https://github.com/${repo}/releases/tag/v${version}`,
  pub_date: new Date().toISOString(),
  platforms: {
    "windows-x86_64": {
      signature,
      url: `https://github.com/${repo}/releases/download/v${version}/${assetName}`,
    },
  },
};
const outPath = resolve(nsisDir, "latest.json");
writeFileSync(outPath, JSON.stringify(manifest, null, 2) + "\n");
console.log(`生成 ${outPath}`);
console.log(`  版本 ${version}；资产名 ${assetName}；发布时把 exe 重命名上传 + latest.json 一并传到 tag v${version}`);
