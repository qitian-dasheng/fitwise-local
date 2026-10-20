import type { StateStorage } from "zustand/middleware";

const DB_URL = "sqlite:fitwise.db";
let dbPromise: Promise<import("@tauri-apps/plugin-sql").default> | null = null;

function isTauri() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
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
    if (!isTauri()) return localStorage.getItem(name);
    const db = await getDb();
    const rows = await db.select<{ value: string }[]>("SELECT value FROM app_kv WHERE key = $1", [name]);
    return rows[0]?.value ?? null;
  },
  async setItem(name, value) {
    if (!isTauri()) {
      localStorage.setItem(name, value);
      return;
    }
    const db = await getDb();
    await db.execute(
      "INSERT INTO app_kv (key, value, updated_at) VALUES ($1, $2, $3) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
      [name, value, new Date().toISOString()],
    );
  },
  async removeItem(name) {
    if (!isTauri()) {
      localStorage.removeItem(name);
      return;
    }
    const db = await getDb();
    await db.execute("DELETE FROM app_kv WHERE key = $1", [name]);
  },
};
