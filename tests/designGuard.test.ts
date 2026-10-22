import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * 设计守卫（0.6.0 起生效，范围限定新层）。
 *
 * 旧 styles.css 尚未退役（M2.5），因此全局断言暂不启用；
 * 本文件只看守卫范围内的「新层」文件，防止新写的内容退化。
 * 范围随 M2.5 旧样式退役扩大到 src/styles/**。
 */
const guardedFiles = [
  "src/styles/theme.css",
  "src/styles/base.css",
  "design/prototype/src/index.template.html",
];

const read = (file: string) => readFileSync(file, "utf8");

describe("设计守卫（scoped）", () => {
  it("新层字号不得低于 10px（设计系统下限 11px，移动端导航 10px 例外）", () => {
    for (const file of guardedFiles) {
      const sizes = [...read(file).matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)].map((m) => Number(m[1]));
      const offenders = sizes.filter((size) => size < 10);
      expect(offenders, `${file} 出现低于 10px 的字号`).toEqual([]);
    }
  });

  it("新层禁止新增投影（box-shadow: none 是合法的去阴影写法）", () => {
    for (const file of guardedFiles) {
      const shadows = [...read(file).matchAll(/box-shadow:(?!\s*none)/g)].length;
      expect(shadows, `${file} 出现非 none 的 box-shadow`).toBe(0);
    }
  });

  it("theme.css 只做旧变量桥接：新值必须引用 tokens 变量或落在允许清单", () => {
    const theme = read("src/styles/theme.css");
    // 桥接允许的色值清单：中性悬停灰、侧栏灰字。新增色值先加进这里并写注释。
    // 白色与中性灰是表面色，不属于调色板；登记后新增彩色仍会被拦下。
    const allowed = ["#f1f4ef", "#9aa19b", "#ffffff"];
    const hexes = [...theme.matchAll(/#[0-9a-fA-F]{6}\b/g)].map((m) => m[0].toLowerCase());
    for (const hex of hexes) {
      expect(allowed, `theme.css 出现未登记的色值 ${hex}`).toContain(hex);
    }
  });

  it("原型模板不得出现旧绿色变量引用（防止样张与新皮肤分叉）", () => {
    const template = read("design/prototype/src/index.template.html");
    expect(template.includes("var(--green")).toBe(false);
  });
});
