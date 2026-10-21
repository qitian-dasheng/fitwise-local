import { afterEach, beforeEach, expect, it, vi } from "vitest";
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
beforeEach(() => { vi.resetModules(); invoke.mockReset(); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("recognizes native origins even when the desktop bridge is missing", async () => {
  const { isDesktopAddress } = await import("../src/data/storage");
  for (const url of ["tauri://localhost/", "http://tauri.localhost/", "https://tauri.localhost/", "http://asset.localhost/"]) expect(isDesktopAddress(url)).toBe(true);
  expect(isDesktopAddress("http://localhost:1420/")).toBe(false);
  expect(isDesktopAddress("https://example.com/")).toBe(false);
});

it("never reads or writes browser storage on a native origin with no bridge", async () => {
  const get = vi.spyOn(Storage.prototype, "getItem"), set = vi.spyOn(Storage.prototype, "setItem");
  vi.stubGlobal("window", { location: { href: "http://tauri.localhost/" } });
  const storage = await import("../src/data/storage");
  expect(storage.isTauriRuntime()).toBe(true);
  await expect(storage.appStorage.getItem("state")).rejects.toThrow("不会切换到浏览器存储");
  await expect(storage.appStorage.setItem("state", "{}" )).rejects.toThrow("桌面连接不可用");
  await expect(storage.flushAppStorageWrites()).rejects.toThrow("桌面连接不可用");
  expect(get).not.toHaveBeenCalled(); expect(set).not.toHaveBeenCalled(); expect(invoke).not.toHaveBeenCalled();
  expect(storage.getStorageFailure()).toContain("桌面连接不可用");
});

it("publishes persistence failures, blocks a false-success flush and recovers after a successful retry", async () => {
  vi.stubGlobal("window", { location: { href: "http://tauri.localhost/" }, __TAURI_INTERNALS__: {} });
  const storage = await import("../src/data/storage");
  const change = vi.fn(); const stop = storage.subscribeStorageFailure(change);
  invoke.mockRejectedValueOnce(new Error("磁盘写入失败"));
  await expect(storage.appStorage.setItem("state", "first")).rejects.toThrow("磁盘写入失败");
  await expect(storage.flushAppStorageWrites()).rejects.toThrow("磁盘写入失败");
  expect(storage.getStorageFailure()).toBe("磁盘写入失败");
  invoke.mockResolvedValueOnce(undefined);
  await storage.appStorage.setItem("state", "retry");
  await expect(storage.flushAppStorageWrites()).resolves.toBeUndefined();
  expect(storage.getStorageFailure()).toBe(""); expect(change).toHaveBeenCalledTimes(2); stop();
});

it("retains browser preview storage when no native origin or bridge exists", async () => {
  const storage = await import("../src/data/storage");
  await storage.appStorage.setItem("preview-test", "preview-only");
  expect(await storage.appStorage.getItem("preview-test")).toBe("preview-only");
  await storage.appStorage.removeItem("preview-test");
  expect(invoke).not.toHaveBeenCalled();
});
