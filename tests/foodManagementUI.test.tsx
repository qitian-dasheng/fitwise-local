import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FoodLibraryModal } from "../src/components/FoodLibraryModal";
import { initialState } from "../src/domain/seed";
import { useAppStore } from "../src/store/appStore";

let container: HTMLDivElement;
let root: Root;
const closed = vi.fn();
let setFoodArchived: ReturnType<typeof vi.fn>;
let deleteFood: ReturnType<typeof vi.fn>;
let correctFoodIdentity: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  useAppStore.setState({
    ...structuredClone(initialState),
    setFoodArchived: (setFoodArchived = vi.fn().mockResolvedValue({})),
    deleteFood: (deleteFood = vi.fn().mockResolvedValue({})),
    correctFoodIdentity: (correctFoodIdentity = vi.fn().mockResolvedValue({})),
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  closed.mockReset();
  await act(async () => {
    root.render(<FoodLibraryModal catalogOnly onClose={closed} onManual={() => undefined} />);
  });
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); });

function button(text: string) {
  const element = [...container.querySelectorAll("button")].find((item) => item.textContent?.includes(text));
  if (!element) throw new Error(`Missing button ${text}`);
  return element;
}
function byLabel(label: string) {
  const element = container.querySelector(`[aria-label="${label}"]`);
  if (!element) throw new Error(`Missing control ${label}`);
  return element as HTMLButtonElement;
}
async function click(text: string) { await act(async () => button(text).click()); }
async function clickLabel(label: string) { await act(async () => byLabel(label).click()); }
function input(label: string) {
  const element = [...container.querySelectorAll("label")].find((item) => item.textContent?.includes(label))?.querySelector("input");
  if (!element) throw new Error(`Missing input ${label}`);
  return element;
}
async function fill(element: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set?.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function enterFood() {
  await click("新建食物");
  await fill(input("食物名称"), "原味燕麦");
  await fill(input("能量（"), "400");
  await fill(input("蛋白质（"), "12");
  await act(async () => input("我已核对").click());
}
async function submit() { await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))); }

it("archives a food out of the daily pickers and restores it from the archived tab", async () => {
  await enterFood();
  await submit();
  expect(useAppStore.getState().foodDefinitions).toHaveLength(1);
  const foodId = useAppStore.getState().foodDefinitions[0].id;

  await clickLabel("归档原味燕麦");
  expect(setFoodArchived).toHaveBeenCalledWith(foodId, true, expect.any(String));

  // 模拟后端已生效：归档项从「全部」列表消失，只在「已归档」列表可见。
  await act(async () => useAppStore.setState((state) => ({ foodDefinitions: state.foodDefinitions.map((item) => item.id === foodId ? { ...item, archived: true } : item) })));
  expect(container.querySelector(".library-results")!.textContent).not.toContain("原味燕麦");
  await click("已归档");
  expect(container.querySelector(".library-results")!.textContent).toContain("原味燕麦");

  await clickLabel("取消归档原味燕麦");
  expect(setFoodArchived).toHaveBeenCalledWith(foodId, false, expect.any(String));
});

it("requires a second confirmation before a permanent delete", async () => {
  await enterFood();
  await submit();
  const foodId = useAppStore.getState().foodDefinitions[0].id;

  await clickLabel("永久删除原味燕麦");
  expect(container.textContent).toContain("永久删除「原味燕麦」？");
  expect(deleteFood).not.toHaveBeenCalled();
  await click("取消");
  expect(container.textContent).not.toContain("永久删除「原味燕麦」？");
  expect(deleteFood).not.toHaveBeenCalled();

  await clickLabel("永久删除原味燕麦");
  await click("确认永久删除");
  expect(deleteFood).toHaveBeenCalledWith(foodId, expect.any(String));
});

it("corrects name and brand through the identity editor without touching specs", async () => {
  await enterFood();
  await submit();
  const foodId = useAppStore.getState().foodDefinitions[0].id;
  const versionsBefore = useAppStore.getState().foodDefinitionVersions.length;

  await clickLabel("纠错原味燕麦的名称或品牌");
  expect(container.textContent).toContain("生熟状态：包装标示");
  await fill(input("食物名称"), "原味燕麦片");
  await fill(input("品牌（可留空）"), "张垣大地");
  await click("保存纠错");
  expect(correctFoodIdentity).toHaveBeenCalledWith(
    { foodId, name: "原味燕麦片", brand: "张垣大地", measurementBasis: "packaged" },
    expect.any(String),
  );
  expect(useAppStore.getState().foodDefinitionVersions).toHaveLength(versionsBefore);
});
