/// <reference types="node" />
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * 设计守卫（0.6.0 起生效；0.9.4 起 M2.5 旧样式退役完成，范围扩大到全部样式层）。
 *
 * 颜色唯一真源检查在 stylesGuard（hex/rgb/rgba 禁令 + 旧令牌引用禁令）；
 * 本文件看守字号下限、投影纪律与原型模板一致性。
 */
const guardedFiles = [
  "src/styles.css",
  "src/styles/ui.css",
  "src/styles/base.css",
  "design/prototype/src/index.template.html",
];

const read = (file: string) => readFileSync(file, "utf8");

describe("设计守卫（scoped）", () => {
  it("样式层字号不得低于 10px（设计系统下限 11px，移动端导航 10px 例外）", () => {
    for (const file of guardedFiles) {
      if (!existsSync(file)) continue;
      const sizes = [...read(file).matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)].map((m) => Number(m[1]));
      const offenders = sizes.filter((size) => size < 10);
      expect(offenders, `${file} 出现低于 10px 的字号`).toEqual([]);
    }
  });

  it("样式层禁止新增投影（none / var(--ui-shadow) / inset 描边环 / 0 0 0 焦点环例外）", () => {
    for (const file of guardedFiles) {
      if (!existsSync(file)) continue;
      const shadows = [...read(file).matchAll(
        /box-shadow:(?!\s*(?:none|var\(--ui-shadow\)|inset|0\s+0\s+0))/g,
      )].length;
      expect(shadows, `${file} 出现非许可的 box-shadow`).toBe(0);
    }
  });

  it("原型模板不得出现旧绿色变量引用（防止样张与新皮肤分叉）", () => {
    const template = read("design/prototype/src/index.template.html");
    expect(template.includes("var(--green")).toBe(false);
  });
});
