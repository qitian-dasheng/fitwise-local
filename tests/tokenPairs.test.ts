/// <reference types="node" />
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * 双主题令牌守卫（0.9.3 起）：--ui-* 令牌层必须浅/深成对——
 * :root 里定义的每个 --ui-* 都必须在 [data-theme="dark"] 里有对应覆盖，
 * 否则深色主题下会出现"半迁移"元素（浅色残留）。对应 DESIGN_SYSTEM §8 守卫第 1 条。
 */
const tokens = readFileSync("src/styles/tokens.css", "utf8");

function varsOf(block: string): Set<string> {
  return new Set([...block.matchAll(/(--ui-[a-z0-9-]+)\s*:/g)].map((match) => match[1]));
}

// 取 D 层的 :root 块（含 --ui-bg 的最后一个）与 [data-theme="dark"] 覆盖块
const dLightMatch = [...tokens.matchAll(/:root\s*\{[^}]*--ui-bg[^}]*\}/g)].at(-1);
const dDarkMatch = tokens.match(/\[data-theme="dark"\]\s*\{[^}]*--ui-bg[^}]*\}/);

describe("双主题令牌守卫（tokenPairs）", () => {
  it("D 令牌层存在（浅色与深色块都能找到）", () => {
    expect(dLightMatch, "tokens.css 缺少含 --ui-bg 的 :root D 层").toBeTruthy();
    expect(dDarkMatch, "tokens.css 缺少 [data-theme=\"dark\"] 覆盖层").toBeTruthy();
  });

  it("浅色层定义的每个 --ui-* 令牌在深色层都有对应覆盖", () => {
    expect(dLightMatch && dDarkMatch).toBeTruthy();
    const light = varsOf(dLightMatch![0]);
    const dark = varsOf(dDarkMatch![0]);
    const missing = [...light].filter((name) => !dark.has(name));
    expect(missing, `深色主题缺少覆盖：${missing.join("、")}`).toEqual([]);
  });
});
