// 把设计样张打成单文件：令牌与字体全部内联。
//
// 为什么需要它：样张一旦被"只托管单个 HTML"的预览器打开，任何相对路径的样式表都会 404，
// 于是 var(--...) 全部失效、页面退化成无样式的骨架。内联之后，file://、静态预览、
// http 服务三种打开方式表现一致。
//
// 单一真源没有变：色值与字号仍然只有 src/styles/tokens.css 一处，这里只是把它搬进 HTML。
// 用法：node scripts/build-prototype.mjs

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fontsDir = resolve(root, "src/assets/fonts");
const templatePath = resolve(root, "design/prototype/src/index.template.html");
const outputPath = resolve(root, "design/prototype/index.html");

const tokens = readFileSync(resolve(root, "src/styles/tokens.css"), "utf8");
const fonts = readFileSync(resolve(root, "src/styles/fonts.css"), "utf8");

const inlinedFonts = fonts.replace(/url\("\.\.\/assets\/fonts\/([^"]+)"\)/g, (_match, file) => {
  const base64 = readFileSync(resolve(fontsDir, file)).toString("base64");
  return `url("data:font/woff2;base64,${base64}")`;
});

const template = readFileSync(templatePath, "utf8");
if (!template.includes("<!-- @@STYLES@@")) {
  throw new Error("模板里找不到 <!-- @@STYLES@@ 占位，跳过注入会得到没有样式的样张。");
}

const html = template.replace(
  /<!-- @@STYLES@@[^>]*?-->/,
  `<style>\n${tokens}\n\n${inlinedFonts}\n</style>`,
);

writeFileSync(outputPath, html);
const kilobytes = Math.round(Buffer.byteLength(html) / 1024);
console.log(`生成 ${outputPath}（${kilobytes} KB，令牌与 6 个字体子集已内联）`);
