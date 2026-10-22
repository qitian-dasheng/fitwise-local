import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { DataExportPanel, captureWindowSnapshot } from "../src/components/DataExportPanel";
import { exportDomainJson } from "../src/data/domainQueries";
import { initialState } from "../src/domain/seed";
import { useAppStore } from "../src/store/appStore";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: vi.fn() }));
vi.mock("../src/data/domainQueries", () => ({ exportDomainJson: vi.fn() }));
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  useAppStore.setState(structuredClone(initialState));
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  vi.mocked(invoke).mockReset(); vi.mocked(save).mockReset(); vi.mocked(exportDomainJson).mockReset();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__; vi.restoreAllMocks(); });
const click = (index: number) => act(async () => host.querySelectorAll<HTMLButtonElement>("button")[index].click());

it("uses the native save dialog and verified backend write, not a browser download", async () => {
  const database = { app: "Fitwise Local", source: "sqlite_domain_repository", labelDrafts: [{ id: "draft" }] };
  vi.mocked(exportDomainJson).mockResolvedValue(database);
  vi.mocked(save).mockResolvedValue("C:\\private\\new.json");
  vi.mocked(invoke).mockResolvedValue({ path: "C:\\private\\new.json", bytes: 80, sha256: "verified" });
  await act(async () => root.render(<DataExportPanel/>)); await click(0);
  expect(save).toHaveBeenCalledOnce();
  expect(invoke).toHaveBeenCalledExactlyOnceWith("write_json_export", { outputPath: "C:\\private\\new.json", raw: JSON.stringify(database, null, 2) });
  expect(host.textContent).toContain("已写入并回读校验"); expect(host.querySelector("a")).toBeNull();
});

it("preserves separate-day morning weights and excludes credential-shaped extra properties", () => {
  const state = structuredClone(initialState);
  // Synthetic dates and values, not a reconstruction of the user's health history.
  state.measurements = [{ id: "w1", date: "2025-01-01", weightKg: 78.3, createdAt: "" }, { id: "w2", date: "2025-01-02", weightKg: 78.55, createdAt: "" }];
  const raw = JSON.stringify(captureWindowSnapshot(state));
  expect(JSON.parse(raw).measurements).toEqual(state.measurements);
  expect(raw).toContain("window_snapshot_unverified"); expect(raw).not.toContain("must-not-export");
});

it("cancelling snapshot export writes nothing, does not read SQLite and retains manual-copy text", async () => {
  vi.mocked(save).mockResolvedValue(null);
  await act(async () => root.render(<DataExportPanel/>)); await click(1);
  expect(exportDomainJson).not.toHaveBeenCalled(); expect(invoke).not.toHaveBeenCalled();
  expect(host.textContent).toContain("已取消");
  expect(host.querySelector<HTMLTextAreaElement>("textarea")!.value).toContain("window_snapshot_unverified");
});

it("failed native writes visibly fail and retain captured JSON without changing the store", async () => {
  const before = useAppStore.getState().meals;
  vi.mocked(save).mockResolvedValue("C:\\private\\exists.json");
  vi.mocked(invoke).mockRejectedValue("文件已存在");
  await act(async () => root.render(<DataExportPanel/>)); await click(1);
  expect(host.textContent).toContain("导出未完成"); expect(host.textContent).toContain("文件已存在");
  expect(host.querySelector("textarea")).not.toBeNull(); expect(useAppStore.getState().meals).toBe(before);
});

it("failed database reads retain a clearly unverified window snapshot rather than an old export", async () => {
  vi.mocked(exportDomainJson).mockRejectedValue("读取失败");
  await act(async () => root.render(<DataExportPanel/>)); await click(0);
  expect(host.textContent).toContain("不是数据库导出");
  expect(JSON.parse(host.querySelector<HTMLTextAreaElement>("textarea")!.value).source).toBe("window_snapshot_unverified");
  expect(save).not.toHaveBeenCalled(); expect(invoke).not.toHaveBeenCalled();
});
