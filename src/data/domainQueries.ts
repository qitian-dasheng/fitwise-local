import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { useAppStore } from "../store/appStore";
import type { InventoryLot, NutrientKey } from "../domain/types";
import { enqueueDomainCommand } from "./domainCommands";
import { isTauriRuntime, flushAppStorageWrites } from "./storage";

export interface PeriodSummary {
  revision: number;
  start: string;
  end: string;
  days: { date: string; complete: boolean; mealCount: number; totals: Record<NutrientKey, number>; coverage: Record<NutrientKey, number> }[];
  completedDayCalorieAverage: number | null;
  eligibleDayCount: number;
  workoutMinutes: number;
  latestWeightKg: number | null;
  measurements: { id: string; date: string; weightKg: number; average: number; isOutlier: boolean }[];
}

interface InventorySummary { items: InventoryLot[]; remainingCostCny: number }

function useDomainQuery<T>(command: string, args: Record<string, string>, dependency: unknown) {
  const [result, setResult] = useState<{ data?: T | null; error: string }>({ error: "" });
  const serialized = JSON.stringify(args);
  useEffect(() => {
    if (!isTauriRuntime()) return;
    let disposed = false;
    void enqueueDomainCommand(async () => {
      await flushAppStorageWrites();
      return invoke<T | null>(command, JSON.parse(serialized));
    }).then((data) => { if (!disposed) setResult({ data, error: "" }); })
      .catch((cause) => { if (!disposed) setResult({ error: String(cause) }); });
    return () => { disposed = true; };
  }, [command, serialized, dependency]);
  return { ...result, loading: isTauriRuntime() && result.data === undefined && !result.error };
}

export function usePeriodSummary(start: string, end: string) {
  // Every persisted domain command changes this array, including non-nutrition operations.
  const audit = useAppStore((state) => state.auditEvents);
  return useDomainQuery<PeriodSummary>("query_period_summary", { start, end }, audit);
}

export function useInventorySummary() {
  const audit = useAppStore((state) => state.auditEvents);
  return useDomainQuery<InventorySummary>("query_inventory_summary", {}, audit);
}

export function exportDomainJson() {
  return enqueueDomainCommand(async () => {
    await flushAppStorageWrites();
    return invoke<Record<string, unknown>>("export_domain_json");
  });
}
