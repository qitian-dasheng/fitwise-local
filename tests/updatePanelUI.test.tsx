import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { check } from "@tauri-apps/plugin-updater";
import { getVersion } from "@tauri-apps/api/app";
import { UpdatePanel } from "../src/components/UpdatePanel";

vi.mock("@tauri-apps/plugin-updater", () => ({ check: vi.fn() }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn() }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: vi.fn() }));

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  window.localStorage.clear();
  vi.mocked(check).mockReset();
  vi.mocked(getVersion).mockReset().mockResolvedValue("0.9.3");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  vi.restoreAllMocks();
});
const findButton = (text: string) => [...host.querySelectorAll("button")].find((button) => button.textContent?.includes(text))!;

it("浏览器预览（非 Tauri）显示不可用说明，检查按钮禁用", async () => {
  await act(async () => root.render(<UpdatePanel />));
  expect(host.querySelector("input")!.value).toContain("浏览器预览");
  expect(findButton("检查更新").disabled).toBe(true);
  expect(check).not.toHaveBeenCalled();
});

it("桌面端手动检查：已是最新时给出当前版本反馈", async () => {
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  vi.mocked(getVersion).mockResolvedValue("0.9.3");
  vi.mocked(check).mockResolvedValue(null);
  await act(async () => root.render(<UpdatePanel />));
  await act(async () => { findButton("检查更新").click(); });
  expect(check).toHaveBeenCalledOnce();
  expect(host.textContent).toContain("0.9.3 已是最新");
});

it("桌面端发现新版本：下载→就绪→出现立即重启", async () => {
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  vi.mocked(getVersion).mockResolvedValue("0.9.3");
  const downloadAndInstall = vi.fn().mockResolvedValue(undefined);
  vi.mocked(check).mockResolvedValue({ version: "0.9.4", downloadAndInstall } as never);
  await act(async () => root.render(<UpdatePanel />));
  await act(async () => { findButton("检查更新").click(); });
  expect(downloadAndInstall).toHaveBeenCalledOnce();
  expect(host.textContent).toContain("0.9.4 已就绪");
  expect(findButton("立即重启")).toBeTruthy();
});

it("静默检查偏好默认开，关闭后写 localStorage", async () => {
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  await act(async () => root.render(<UpdatePanel />));
  const toggle = host.querySelector<HTMLInputElement>("input[type=checkbox]")!;
  expect(toggle.checked).toBe(true);
  await act(async () => { toggle.click(); });
  expect(window.localStorage.getItem("qingheng.updates.silent-check")).toBe("0");
});
