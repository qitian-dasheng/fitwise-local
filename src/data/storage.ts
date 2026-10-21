import type { StateStorage } from "zustand/middleware";
import { invoke } from "@tauri-apps/api/core";

let writeQueue: Promise<void> = Promise.resolve();
let suppressedWrites = 0;
let storageFailure = "";
const listeners = new Set<() => void>();
export const getStorageFailure = () => storageFailure;
export function subscribeStorageFailure(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function reportStorageFailure(cause: unknown) {
  storageFailure = cause instanceof Error ? cause.message : String(cause);
  listeners.forEach(listener => listener());
}
function clearStorageFailure() {
  if (!storageFailure) return;
  storageFailure = "";
  listeners.forEach(listener => listener());
}
export function isDesktopAddress(address: string) {
  const url = new URL(address);
  return url.protocol === "tauri:" || ["tauri.localhost", "asset.localhost"].includes(url.hostname);
}

export function isTauriRuntime() {
  return typeof window !== "undefined" && ("__TAURI_INTERNALS__" in window || isDesktopAddress(window.location.href));
}

export function assertDesktopBridge() {
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) {
    throw new Error("桌面连接不可用，已停止保存；不会切换到浏览器存储。请保留当前窗口和输入，先联系维护者保全数据。");
  }
}

export async function flushAppStorageWrites() {
  await writeQueue;
}

export function suppressNextAppStorageWrite() {
  suppressedWrites += 1;
}

export const appStorage: StateStorage = {
  async getItem(name) {
    if (!isTauriRuntime()) return localStorage.getItem(name);
    try {
      assertDesktopBridge();
      await writeQueue;
      const raw = await invoke<string | null>("domain_storage_get", { name });
      clearStorageFailure();
      return raw;
    } catch (cause) { reportStorageFailure(cause); throw cause; }
  },
  async setItem(name, value) {
    if (!isTauriRuntime()) {
      localStorage.setItem(name, value);
      return;
    }
    if (suppressedWrites > 0) {
      suppressedWrites -= 1;
      return;
    }
    writeQueue = writeQueue.catch(() => undefined).then(() => {
      assertDesktopBridge();
      return invoke<void>("domain_storage_set", { name, value });
    });
    try { await writeQueue; clearStorageFailure(); }
    catch (cause) { reportStorageFailure(cause); throw cause; }
  },
  async removeItem(name) {
    if (!isTauriRuntime()) {
      localStorage.removeItem(name);
      return;
    }
    writeQueue = writeQueue.catch(() => undefined).then(() => {
      assertDesktopBridge();
      return invoke<void>("domain_storage_remove", { name });
    });
    try { await writeQueue; clearStorageFailure(); }
    catch (cause) { reportStorageFailure(cause); throw cause; }
  },
};
