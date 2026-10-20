import type { StateStorage } from "zustand/middleware";
import { invoke } from "@tauri-apps/api/core";

let writeQueue: Promise<void> = Promise.resolve();
let suppressedWrites = 0;

export function isTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function flushAppStorageWrites() {
  await writeQueue.catch(() => undefined);
}

export function suppressNextAppStorageWrite() {
  suppressedWrites += 1;
}

export const appStorage: StateStorage = {
  async getItem(name) {
    if (!isTauriRuntime()) return localStorage.getItem(name);
    await writeQueue.catch(() => undefined);
    return invoke<string | null>("domain_storage_get", { name });
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
    writeQueue = writeQueue.catch(() => undefined).then(() => invoke<void>("domain_storage_set", { name, value }));
    await writeQueue;
  },
  async removeItem(name) {
    if (!isTauriRuntime()) {
      localStorage.removeItem(name);
      return;
    }
    writeQueue = writeQueue.catch(() => undefined).then(() => invoke<void>("domain_storage_remove", { name }));
    await writeQueue;
  },
};
