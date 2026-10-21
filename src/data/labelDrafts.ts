import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { isTauriRuntime } from "./storage";
import { notifyInputs } from "./artifacts";
import type { LabelDraftRecord, LabelDraftSummary } from "../domain/labelDrafts";

export const notifyLabelDrafts = () => { window.dispatchEvent(new Event("fitwise-labels-changed")); notifyInputs(); };
export const readLabelDraft = (id: string) => invoke<LabelDraftRecord>("get_label_draft", { id });
export function useLabelDrafts(status: string, offset: number) {
  const [data, setData] = useState<{ items: LabelDraftSummary[]; hasMore: boolean }>({ items: [], hasMore: false });
  const [loading, setLoading] = useState(false), [error, setError] = useState("");
  useEffect(() => {
    if (!isTauriRuntime()) return;
    let active = true, sequence = 0;
    const refresh = () => {
      const current = ++sequence; setLoading(true);
      void invoke<typeof data>("list_label_drafts", { status, offset }).then(value => { if (active && current === sequence) { setData(value); setError(""); } }).catch(e => { if (active && current === sequence) setError(String(e)); }).finally(() => { if (active && current === sequence) setLoading(false); });
    };
    refresh(); window.addEventListener("fitwise-labels-changed", refresh);
    return () => { active = false; window.removeEventListener("fitwise-labels-changed", refresh); };
  }, [status, offset]);
  return { data, loading, error };
}
