/// <reference types="node" />
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * 图表容器高度守卫（0.9.2 起）：recharts 的 ResponsiveContainer 用 height="100%"，
 * 父容器若是 auto 高度就解析为 0，图表以 0×0 静默渲染——不报错、jsdom 也不做布局，
 * 只有这条守卫能拦住（0.9.2 验收中身体页/趋势页图表空白的根因即 .chart-large 缺基础高度）。
 * 正则只认"类名后紧跟花括号"的裸规则，:has() 空态覆盖不算数。
 */
const styles = readFileSync("src/styles.css", "utf8");

const hasBaseHeight = (className: string) =>
  new RegExp(`\\.${className}\\s*\\{[^}]*height\\s*:`).test(styles);

describe("图表容器高度守卫（stylesGuard）", () => {
  it.each(["chart-large", "chart-small", "girth-chart"])(
    ".%s 必须有带显式高度的基础规则",
    (className) => {
      expect(hasBaseHeight(className)).toBe(true);
    },
  );
});
