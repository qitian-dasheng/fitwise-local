import type { StateStorage } from "zustand/middleware";
import { invoke } from "@tauri-apps/api/core";

const DB_URL = "sqlite:fitwise.db";
let dbPromise: Promise<import("@tauri-apps/plugin-sql").default> | null = null;
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

async function getDb() {
  if (!dbPromise) {
    dbPromise = import("@tauri-apps/plugin-sql").then(async ({ default: Database }) => {
      const db = await Database.load(DB_URL);
      await db.execute(
        "CREATE TABLE IF NOT EXISTS app_kv (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL, updated_at TEXT NOT NULL)",
      );
      return db;
    });
  }
  return dbPromise;
}

export const appStorage: StateStorage = {
  async getItem(name) {
    if (!isTauriRuntime()) return localStorage.getItem(name);
    await getDb();
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
    await getDb();
    writeQueue = writeQueue.catch(() => undefined).then(() => invoke<void>("domain_storage_set", { name, value }));
    await writeQueue;
  },
  async removeItem(name) {
    if (!isTauriRuntime()) {
      localStorage.removeItem(name);
      return;
    }
    await getDb();
    writeQueue = writeQueue.catch(() => undefined).then(() => invoke<void>("domain_storage_remove", { name }));
    await writeQueue;
  },
};
