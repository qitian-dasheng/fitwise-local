import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AiDraftModal } from "../src/components/AiDraftModal";
import { AiSettingsModal, readAiCollectSettings, writeAiCollectSettings } from "../src/components/AiSettingsModal";
import { useFoodPicker } from "../src/store/foodPicker";

let container: HTMLDivElement;
let root: Root;
const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }));

beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  (window as unknown as Record<string, unknown>).invoke = invokeMock;
  localStorage.clear();
  useFoodPicker.setState({ basket: [] });
  invokeMock.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

async function fillInput(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
      "value",
    )!.set!;
    setter.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

it("settings modal persists ollama settings and default is disabled", async () => {
  await act(async () => root.render(<AiSettingsModal onClose={() => undefined}/>));
  const toggle = container.querySelector<HTMLInputElement>('.checkbox-label input[type="checkbox"]')!;
  expect(toggle.checked).toBe(false);
  await act(async () => toggle.click());
  expect(readAiCollectSettings().enabled).toBe(true);
  expect(readAiCollectSettings().base).toBe("http://localhost:11434");
});

it("settings modal tests connection and lists models", async () => {
  invokeMock.mockResolvedValue(["qwen3.5:9b", "qwen3.6:35b-a3b-q4_K_M"]);
  await act(async () => root.render(<AiSettingsModal onClose={() => undefined}/>));
  await act(async () => [...container.querySelectorAll("button")].find((button) => button.textContent?.includes("测试连接"))!.click());
  expect(invokeMock).toHaveBeenCalledWith("ollama_list_models", { base: "http://localhost:11434" });
  const select = container.querySelector<HTMLSelectElement>(".form-grid select")!;
  expect(select.options).toHaveLength(2);
  expect(select.value).toBe("qwen3.5:9b");
});

it("generates drafts from a description and adds them to the basket", async () => {
  writeAiCollectSettings({ enabled: true, base: "http://localhost:11434", model: "qwen3.5:9b" });
  await act(async () => root.render(<AiDraftModal date="2026-10-26" onClose={() => undefined}/>));
  invokeMock.mockImplementation((_command: string, args: { description: string }) =>
    Promise.resolve({
      model: "qwen3.5:9b",
      items: [
        { name: "鸡蛋", amountLabel: "2 个", nutrition: { calories: { state: "known", value: 140, unit: "kcal", source: "ai_estimate", confidence: "low" }, protein: { state: "known", value: 12, unit: "g", source: "ai_estimate", confidence: "low" }, carbohydrates: { state: "unknown", unit: "g", source: "ai_estimate", confidence: "low" }, fat: { state: "known", value: 9, unit: "g", source: "ai_estimate", confidence: "low" }, fiber: { state: "unknown", unit: "g", source: "ai_estimate", confidence: "low" }, sugar: { state: "unknown", unit: "g", source: "ai_estimate", confidence: "low" }, sodium: { state: "unknown", unit: "mg", source: "ai_estimate", confidence: "low" } } },
        { name: "豆浆", amountLabel: "一杯", nutrition: { calories: { state: "known", value: 80, unit: "kcal", source: "ai_estimate", confidence: "low" }, protein: { state: "known", value: 7, unit: "g", source: "ai_estimate", confidence: "low" }, carbohydrates: { state: "unknown", unit: "g", source: "ai_estimate", confidence: "low" }, fat: { state: "unknown", unit: "g", source: "ai_estimate", confidence: "low" }, fiber: { state: "unknown", unit: "g", source: "ai_estimate", confidence: "low" }, sugar: { state: "unknown", unit: "g", source: "ai_estimate", confidence: "low" }, sodium: { state: "unknown", unit: "mg", source: "ai_estimate", confidence: "low" } } },
      ],
    }),
  );
  const textarea = container.querySelector<HTMLTextAreaElement>("textarea")!;
  await fillInput(textarea, "两个鸡蛋一杯豆浆");
  await act(async () => [...container.querySelectorAll("button")].find((button) => button.textContent?.includes("生成草稿"))!.click());
  expect(invokeMock).toHaveBeenCalledWith("ollama_draft", { base: "http://localhost:11434", model: "qwen3.5:9b", description: "两个鸡蛋一杯豆浆" });
  // 草稿可编辑（默认 100g 进篮子）。
  const nameInput = container.querySelector<HTMLInputElement>('.ai-draft-name input')!;
  expect(nameInput.value).toBe("鸡蛋");
  const addBtn = [...container.querySelectorAll("button")].find((button) => button.textContent?.includes("全部加入待确认篮子"));
  await act(async () => addBtn!.click());
  expect(useFoodPicker.getState().basket).toHaveLength(2);
  expect(useFoodPicker.getState().basket[0].name).toBe("鸡蛋");
  expect(useFoodPicker.getState().basket[0].facts.calories.value).toBe(140);
  // 篮子收到草稿条目（确认写入在 BasketBar）；测试的 onClose 为空函数，弹窗保持打开属预期。
});

it("keeps the modal open on generation failure and shows the error", async () => {
  await act(async () => root.render(<AiDraftModal date="2026-10-26" onClose={() => undefined}/>));
  invokeMock.mockRejectedValue("Ollama 请求失败");
  const textarea = container.querySelector<HTMLTextAreaElement>("textarea")!;
  await fillInput(textarea, "随便写的");
  await act(async () => [...container.querySelectorAll("button")].find((button) => button.textContent?.includes("生成草稿"))!.click());
  expect(container.querySelector(".modal")).not.toBeNull();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("Ollama 请求失败");
});
