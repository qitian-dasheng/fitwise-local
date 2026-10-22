import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { isTauriRuntime } from "./storage";

/** 与 data/labelDrafts.ts 同构：列表按需读取、事件驱动刷新。 */

export interface MenuDraftSummary {
  id: string;
  revision: number;
  status: "draft" | "confirmed" | "discarded";
  title: string | null;
  planId: string | null;
  date: string | null;
  updatedAt: string;
  failingChecks: number;
  totalChecks: number;
}

export interface MenuDraftCheck {
  name: string;
  ok: boolean;
  error?: string;
  note?: string;
}

export interface MenuDraftRecord {
  id: string;
  revision: number;
  status: "draft" | "confirmed" | "discarded";
  draft: Record<string, unknown>;
  checks: MenuDraftCheck[];
  planId: string | null;
  date: string | null;
  createdAt: string;
  updatedAt: string;
}

export const notifyMenuDrafts = () => {
  window.dispatchEvent(new Event("fitwise-menu-drafts-changed"));
};

export const readMenuDraft = (id: string) => invoke<MenuDraftRecord>("get_menu_draft", { id });

export function useMenuDrafts(status: string, offset: number) {
  const [data, setData] = useState<{ items: MenuDraftSummary[]; hasMore: boolean }>({ items: [], hasMore: false });
  const [loading, setLoading] = useState(false), [error, setError] = useState("");
  useEffect(() => {
    if (!isTauriRuntime()) return;
    let active = true, sequence = 0;
    const refresh = () => {
      const current = ++sequence; setLoading(true);
      void invoke<typeof data>("list_menu_drafts", { status, offset }).then(value => { if (active && current === sequence) { setData(value); setError(""); } }).catch(e => { if (active && current === sequence) setError(String(e)); }).finally(() => { if (active && current === sequence) setLoading(false); });
    };
    refresh(); window.addEventListener("fitwise-menu-drafts-changed", refresh);
    return () => { active = false; window.removeEventListener("fitwise-menu-drafts-changed", refresh); };
  }, [status, offset]);
  return { data, loading, error };
}
