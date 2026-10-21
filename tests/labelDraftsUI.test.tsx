import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LabelDraftModal } from "../src/components/LabelDrafts";
import { emptyLabelForm, type LabelDraftRecord } from "../src/domain/labelDrafts";
import { useAppStore } from "../src/store/appStore";
import { initialState } from "../src/domain/seed";

let host: HTMLDivElement, root: Root;
const original = useAppStore.getState().labelDraftCommand, close = vi.fn();
const record = (): LabelDraftRecord => ({ id: "draft-1", revision: 2, status: "draft", name: "燕麦", sourceReceiptId: null, sourceArtifactId: null, foodId: null, foodVersionId: null, updatedAt: "2026-10-21T00:00:00Z", createdAt: "2026-10-21T00:00:00Z", sourceName: null, sourceMime: null, sourceUnavailable: false, form: { ...emptyLabelForm(), name: "燕麦", nutrients: { ...emptyLabelForm().nutrients, calories: "1600" } } });
const button = (name: string) => [...host.querySelectorAll("button")].find(b => b.textContent?.includes(name))!;
const field = (name: string) => [...host.querySelectorAll("label")].find(l => l.textContent?.startsWith(name))!.querySelector<HTMLInputElement>("input")!;
async function fill(input: HTMLInputElement, value: string) { await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); }); }
beforeEach(() => { (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true; delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__; useAppStore.setState({ ...structuredClone(initialState), labelDraftCommand: original }); host = document.createElement("div"); document.body.append(host); root = createRoot(host); close.mockReset(); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); useAppStore.setState({ labelDraftCommand: original }); });

it("saves incomplete data without inventing nutrition, then enables resume identity", async () => {
  const command = vi.fn().mockResolvedValue({ draftId: "d1", draftRevision: 1 }); useAppStore.setState({ labelDraftCommand: command });
  await act(async () => root.render(<LabelDraftModal onClose={close}/>));
  await fill(field("食物名称"), "待补标签"); await act(async () => button("保存草稿").click());
  expect(command.mock.calls[0][0]).toBe("save_label_draft"); expect(command.mock.calls[0][1].form.nutrients.calories).toBe("");
  expect(host.textContent).toContain("草稿已保存到本机"); expect(button("确认建立").disabled).toBe(true); expect(close).not.toHaveBeenCalled();
});
it("requires four checks and passes persisted revision; edit invalidates review", async () => {
  const command = vi.fn().mockResolvedValue({ foodId: "food-1", foodVersionId: "fv1" }); useAppStore.setState({ labelDraftCommand: command });
  await act(async () => root.render(<LabelDraftModal draft={record()} onClose={close}/>));
  expect(button("确认建立").disabled).toBe(true);
  for (const input of host.querySelectorAll<HTMLInputElement>(".label-review > label input")) await act(async () => input.click());
  expect(button("确认建立").disabled).toBe(false);
  await fill(field("食物名称"), "新版燕麦"); expect(button("确认建立").disabled).toBe(true); expect(host.querySelector<HTMLInputElement>(".label-review input")!.checked).toBe(false);
  expect(command).not.toHaveBeenCalled();
});
it("confirmation creates only library metadata, freezes source and does not record a meal", async () => {
  const command = vi.fn().mockResolvedValue({ foodId: "food-1", foodVersionId: "fv1" }); useAppStore.setState({ labelDraftCommand: command });
  await act(async () => root.render(<LabelDraftModal draft={record()} onClose={close}/>));
  for (const input of host.querySelectorAll<HTMLInputElement>(".label-review > label input")) await act(async () => input.click());
  await act(async () => button("确认建立").click());
  expect(command).toHaveBeenCalledTimes(1); expect(command.mock.calls[0][0]).toBe("confirm_label_draft"); expect(command.mock.calls[0][1]).toMatchObject({ draftId: "draft-1", expectedRevision: 2 });
  expect(field("食物名称").closest("fieldset")!.disabled).toBe(true); expect(host.textContent).toContain("未写入饮食或库存"); expect(useAppStore.getState().meals).toEqual(initialState.meals);
});
it("failure retains input and retry command identity; double click cannot submit twice", async () => {
  const command = vi.fn().mockResolvedValue({ error: "磁盘不可写" }); useAppStore.setState({ labelDraftCommand: command });
  await act(async () => root.render(<LabelDraftModal onClose={close}/>)); await fill(field("食物名称"), "测试食品");
  await act(async () => { button("保存草稿").click(); button("保存草稿").click(); });
  expect(command).toHaveBeenCalledTimes(1); expect(field("食物名称").value).toBe("测试食品");
  await act(async () => button("保存草稿").click()); expect(command.mock.calls[0][2]).toBe(command.mock.calls[1][2]);
});
it("warns before discarding unsaved work and never simulates browser success", async () => {
  await act(async () => root.render(<LabelDraftModal onClose={close}/>)); await fill(field("食物名称"), "未保存");
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="关闭"]')!.click()); expect(close).not.toHaveBeenCalled(); expect(host.textContent).toContain("尚未保存");
  await act(async () => button("返回继续").click()); await act(async () => button("保存草稿").click()); expect(host.textContent).toContain("需要桌面版"); expect(field("食物名称").value).toBe("未保存");
});
it("confirmed source is readonly, including unavailable image evidence", async () => {
  const d = record(); d.status = "confirmed"; d.sourceArtifactId = "missing"; d.sourceReceiptId = "receipt"; d.sourceUnavailable = true;
  await act(async () => root.render(<LabelDraftModal draft={d} onClose={close}/>));
  expect(host.textContent).toContain("来源原件已删除"); expect(host.querySelectorAll("img")).toHaveLength(0); expect([...host.querySelectorAll("button")].some(b => b.textContent?.includes("保存草稿"))).toBe(false);
});
it("does not repeat an identical per-100g preview", async () => {
  await act(async () => root.render(<LabelDraftModal draft={record()} onClose={close}/>));
  expect(host.querySelectorAll(".label-preview > div")).toHaveLength(1);
  expect(host.querySelector(".label-preview")!.textContent).toContain("当前参考规格");
});
it("closing an untouched new blank form does not warn about nonexistent edits", async () => {
  await act(async () => root.render(<LabelDraftModal onClose={close}/>));
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="关闭"]')!.click());
  expect(close).toHaveBeenCalledTimes(1); expect(host.querySelector(".label-close-warning")).toBeNull();
});
