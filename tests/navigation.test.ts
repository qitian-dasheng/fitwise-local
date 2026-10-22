import { describe, expect, it } from "vitest";
import { legacyPageTargets, navItems, toolItems } from "../src/domain/navigation";

// 0.9 信息架构：导航 5 → 4 + 工具 1。这条用例守住入口数量与归属，防止以后悄悄加回去。
describe("0.9 信息架构", () => {
  it("主导航收缩为四个入口，顺序即使用频率", () => {
    expect(navItems.map((item) => item.id)).toEqual(["today", "food", "body", "workout"]);
    expect(navItems.map((item) => item.label)).toEqual(["今日", "饮食", "身体", "运动"]);
  });

  it("低频页面归入工具分组", () => {
    expect(toolItems.map((item) => item.id)).toEqual(["settings"]);
    // 工具组里不允许再混入主入口。
    expect(toolItems.every((item) => !navItems.some((main) => main.id === item.id))).toBe(true);
  });

  it("被合并的旧页面都有明确的去处", () => {
    expect(legacyPageTargets).toEqual({ trends: "body" });
    // 兜底目标必须真实存在：不是主入口就是工具项。
    const known = [...navItems, ...toolItems].map((item) => item.id);
    for (const target of Object.values(legacyPageTargets)) {
      expect(known).toContain(target);
    }
  });

  it("每个导航项都有图标与中文标签", () => {
    for (const item of [...navItems, ...toolItems]) {
      expect(item.label.length).toBeGreaterThan(0);
      expect(item.icon).toBeTruthy();
    }
  });
});
