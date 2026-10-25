/// <reference types="node" />
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * 样式守卫（0.9.2 图表高度 / 0.9.4 深色根治）：
 * 1. 图表容器必须有显式高度——recharts 的 ResponsiveContainer 用 height="100%"，
 *    父容器 auto 高度会解析为 0，图表以 0×0 静默渲染（0.9.2 验收空白的根因）。
 *    正则只认"类名后紧跟花括号"的裸规则，:has() 空态覆盖不算数。
 * 2. 组件样式层（styles.css / ui.css / base.css）禁一切色值字面量与旧令牌引用——
 *    颜色唯一真源是 tokens.css（含遮罩在内的 rgba 也只允许出现在 tokens.css，
 *    组件层用既有 --ui-* 表达；0.9.4 前深色主题残留白卡/浅字的根因就是绕开令牌写死颜色）。
 * 3. theme.css 桥接层已随 M2.5 退役，不允许复活。
 */
const styles = readFileSync("src/styles.css", "utf8");
const ui = readFileSync("src/styles/ui.css", "utf8");
const base = readFileSync("src/styles/base.css", "utf8");

const hasBaseHeight = (className: string) =>
  new RegExp(`\\.${className}\\s*\\{[^}]*height\\s*:`).test(styles);

const HEX = /#[0-9a-fA-F]{3,8}\b/;
const FUNC_COLOR = /\brgba?\(/;
const LEGACY_VARS =
  /var\(--(?:muted|ink|ink-\d+|green|green-dark|green-pale|blue|amber|coral|line|line-soft|border|surface[\w-]*|shadow|accent[\w-]*|ok[\w-]*|warn[\w-]*|danger[\w-]*|info[\w-]*|chart[\w-]*|focus-ring)\)/;

describe("图表容器高度守卫（stylesGuard）", () => {
  it.each(["chart-large", "girth-chart"])(
    ".%s 必须有带显式高度的基础规则",
    (className) => {
      expect(hasBaseHeight(className)).toBe(true);
    },
  );
});

describe("颜色令牌守卫（0.9.4 深色根治）", () => {
  it.each([
    ["src/styles.css", styles],
    ["src/styles/ui.css", ui],
    ["src/styles/base.css", base],
  ])("%s 不含色值字面量（hex / rgb / rgba）", (_name, css) => {
    const hexHits = css.match(new RegExp(HEX, "g")) ?? [];
    const funcHits = css.match(new RegExp(FUNC_COLOR, "g")) ?? [];
    expect(
      { hex: hexHits, func: funcHits },
      "色值只能出现在 tokens.css；遮罩/阴影请用 --ui-* 表达",
    ).toEqual({ hex: [], func: [] });
  });

  it.each([
    ["src/styles.css", styles],
    ["src/styles/ui.css", ui],
    ["src/styles/base.css", base],
  ])("%s 不引用已退役的旧令牌", (_name, css) => {
    const hits = css.match(new RegExp(LEGACY_VARS, "g")) ?? [];
    expect(hits, "旧令牌无深色覆盖，引用即产生浅色残留").toEqual([]);
  });

  it("theme.css 桥接层保持退役（颜色经 tokens.css 直达，不再重映射）", () => {
    expect(existsSync("src/styles/theme.css")).toBe(false);
  });
});
