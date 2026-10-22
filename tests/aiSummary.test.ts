import { beforeEach, describe, expect, it } from "vitest";
import { buildAiSummary } from "../src/domain/aiSummary";
import { diaryToday } from "../src/domain/diary";
import { initialState } from "../src/domain/seed";
import { useAppStore } from "../src/store/appStore";
import type { AppState, InventoryLot } from "../src/domain/types";

const day = diaryToday();

function lot(overrides: Partial<InventoryLot> & { id: string }): InventoryLot {
  return {
    foodId: `food-${overrides.id}`,
    name: "里脊",
    purchasedAmount: 400,
    remainingAmount: 400,
    unit: "g",
    purchasePriceCny: 10,
    purchasedAt: day,
    opened: false,
    confidence: "high",
    ...overrides,
  };
}

function stateWith(overrides: Partial<AppState> = {}): AppState {
  return { ...structuredClone(initialState), ...overrides } as AppState;
}

beforeEach(() => {
  useAppStore.setState(stateWith());
});

describe("buildAiSummary", () => {
  it("包含目标、身体与格式模板，且不含 AI 配置与审计内容", () => {
    const state = stateWith({ aiSettings: { ...structuredClone(initialState).aiSettings, model: "secret-model", baseUrl: "https://secret.example" } });
    const text = buildAiSummary(state, day);
    expect(text).toContain("菜单授权摘要");
    expect(text).toContain("每日热量");
    expect(text).toContain(`蛋白质 ≥ ${state.profile.proteinTargetG} g`);
    expect(text).toContain("阶段体重");
    // 0.8.1 瘦身：示例为菜单骨架（items 只需 name），营养规格可选但单位约束仍须声明。
    expect(text).toContain('"items"');
    expect(text).toContain("basisUnit 只能是 g / ml / piece / serving / package");
    // 授权摘要只含「读」的最小事实：模型名、接口地址、审计事件一概不出现。
    expect(text).not.toContain("secret-model");
    expect(text).not.toContain("secret.example");
    expect(text).not.toContain("auditEvents");
  });

  it("近 7 天无完整日时明确说明，不拿空白当 0", () => {
    const text = buildAiSummary(stateWith(), day);
    expect(text).toContain("完整日 0 天");
    expect(text).not.toContain("日均热量 0 kcal");
  });

  it("库存按名称+单位合并剩余量，空库存给空态", () => {
    const text = buildAiSummary(
      stateWith({ inventory: [lot({ id: "a", name: "里脊", remainingAmount: 300 }), lot({ id: "b", name: "里脊", remainingAmount: 100 })] }),
      day,
    );
    expect(text).toContain("里脊：400 g");
    const empty = buildAiSummary(stateWith({ inventory: [] }), day);
    expect(empty).toContain("- （空）");
  });

  it("最新晨重取所选日之前最近的代表称重", () => {
    const text = buildAiSummary(
      stateWith({ measurements: [
        { id: "m1", date: day, weightKg: 83.8, source: "manual" as const, createdAt: `${day}T07:00:00Z` },
      ] as unknown as AppState["measurements"] }),
      day,
    );
    expect(text).toContain("最新晨重 83.8 kg");
  });
});
