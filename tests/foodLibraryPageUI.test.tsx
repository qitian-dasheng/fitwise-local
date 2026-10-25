import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FoodLibraryPage } from "../src/pages/FoodLibraryPage";
import { FoodLibraryModal } from "../src/components/FoodLibraryModal";
import { initialState } from "../src/domain/seed";
import { useAppStore } from "../src/store/appStore";
import { useFoodPicker } from "../src/store/foodPicker";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  window.localStorage.clear();
  useAppStore.setState(structuredClone(initialState));
  useFoodPicker.setState({ basket: [], editorTarget: null, returnTicket: null });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

const button = (text: string) =>
  [...host.querySelectorAll("button")].find((item) => item.textContent?.includes(text)) as HTMLButtonElement;
const input = (label: string) =>
  [...host.querySelectorAll("label")].find((item) => item.textContent?.includes(label))?.querySelector("input") as HTMLInputElement;

async function fill(element: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function renderPage(props: { goTo?: (page: string) => void } = {}) {
  await act(async () => { root.render(<FoodLibraryPage {...props} />); });
}

async function fillEditor() {
  await fill(input("食物名称"), "全麦面包");
  await fill(input("能量（"), "250");
  await fill(input("蛋白质（"), "9");
}

async function submitEditor() {
  await act(async () => input("我已核对").click());
  await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
}

it("renders the empty library with the create entry", async () => {
  await renderPage();
  expect(host.textContent).toContain("食材库还是空的");
  expect(button("新建食物")).toBeTruthy();
});

it("creates food through the full-page editor", async () => {
  await renderPage();
  await act(async () => button("新建食物").click());
  expect(host.textContent).toContain("保存营养资料");
  await fillEditor();
  await submitEditor();
  const definitions = useAppStore.getState().foodDefinitions;
  expect(definitions).toHaveLength(1);
  expect(definitions[0].name).toBe("全麦面包");
  expect(host.textContent).toContain("已保存");
});

it("opens the editor from a picker handoff and offers the return ticket", async () => {
  const goTo = vi.fn();
  useFoodPicker.setState({ editorTarget: "new" });
  await renderPage({ goTo });
  expect(host.textContent).toContain("从记餐转来");
  await fillEditor();
  await submitEditor();
  expect(useFoodPicker.getState().returnTicket).toBeTruthy();
  await act(async () => button("返回记餐").click());
  expect(goTo).toHaveBeenCalledWith("food");
});

it("drops stale basket entries when a food is revised on the page", async () => {
  await renderPage();
  await act(async () => button("新建食物").click());
  await fillEditor();
  await submitEditor();
  const version = useAppStore.getState().foodDefinitionVersions[0];
  useFoodPicker.setState({
    basket: [{ foodVersionId: version.id, quantity: 100, unit: "g", name: "全麦面包", facts: version.nutrition }],
  });
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label^="修订"]')!.click());
  await fill(input("能量（"), "300");
  await submitEditor();
  expect(useAppStore.getState().foodDefinitionVersions).toHaveLength(2);
  expect(useFoodPicker.getState().basket).toHaveLength(0);
});

it("picker modal hands the editor over when onOpenEditor is provided", async () => {
  const onOpenEditor = vi.fn();
  await act(async () => { root.render(<FoodLibraryModal onClose={() => undefined} onManual={() => undefined} onOpenEditor={onOpenEditor} />); });
  await act(async () => button("新建食物").click());
  expect(onOpenEditor).toHaveBeenCalledWith("new");
  expect(host.textContent).not.toContain("保存资料，继续填写摄入量");
});

it("picker modal preselects the food named by the return ticket", async () => {
  const result = await useAppStore.getState().saveFoodDefinition(
    { name: "无糖酸奶", measurementBasis: "packaged", basis: { quantity: 100, unit: "g" }, energyUnit: "kcal", nutrients: { calories: 60, protein: 3 }, conversions: [], source: "label" },
    undefined,
    undefined,
    "seed-command",
  );
  expect(result.foodId).toBeTruthy();
  await act(async () => { root.render(<FoodLibraryModal onClose={() => undefined} onManual={() => undefined} preselectFoodId={result.foodId!} />); });
  expect(host.querySelector(".library-portion")?.textContent).toContain("无糖酸奶");
});
