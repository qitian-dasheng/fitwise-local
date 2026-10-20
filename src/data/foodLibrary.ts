import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { calculateFoodPortion, searchFoodState } from "../domain/foodLibrary";
import type { FoodLibraryItem, FoodMealInput, FoodMealPreview } from "../domain/types";
import { useAppStore } from "../store/appStore";
import { enqueueDomainCommand } from "./domainCommands";
import { isTauriRuntime } from "./storage";

export function useFoodLibrarySearch(query: string, mode: "all" | "recent" | "favorites") {
  const state = useAppStore();
  const [remote, setRemote] = useState<{ key: string; data: FoodLibraryItem[]; error: string }>({ key: "", data: [], error: "" });
  const key = JSON.stringify([query, mode]);
  useEffect(() => {
    if (!isTauriRuntime()) return;
    let disposed = false;
    void enqueueDomainCommand(() => invoke<FoodLibraryItem[]>("search_food_library", { query, mode }))
      .then((data) => { if (!disposed) setRemote({ key, data, error: "" }); })
      .catch((cause) => { if (!disposed) setRemote({ key, data: [], error: String(cause) }); });
    return () => { disposed = true; };
  }, [query, mode, key, state.foodDefinitions, state.foodDefinitionVersions, state.meals]);
  return isTauriRuntime()
    ? { items: remote.key === key ? remote.data : [], error: remote.key === key ? remote.error : "", loading: remote.key !== key }
    : { items: searchFoodState(state, query, mode), error: "", loading: false };
}

export function useFoodPortionPreview(entry: FoodMealInput["entries"][number] | null) {
  const versions = useAppStore((state) => state.foodDefinitionVersions);
  const [remote, setRemote] = useState<{ key: string; data?: FoodMealPreview; error: string }>({ key: "", error: "" });
  const key = JSON.stringify(entry);
  useEffect(() => {
    if (!entry || !isTauriRuntime()) return;
    let disposed = false;
    void enqueueDomainCommand(() => invoke<FoodMealPreview>("preview_food_portion", { entry }))
      .then((data) => { if (!disposed) setRemote({ key, data, error: "" }); })
      .catch((cause) => { if (!disposed) setRemote({ key, error: String(cause) }); });
    return () => { disposed = true; };
  }, [key, versions]); // key contains the full immutable request.
  if (!entry) return { data: undefined, error: "", loading: false };
  if (isTauriRuntime()) return { data: remote.key === key ? remote.data : undefined, error: remote.key === key ? remote.error : "", loading: remote.key !== key };
  try {
    const version = versions.find((item) => item.id === entry.foodVersionId);
    if (!version) throw new Error("找不到规格版本。");
    return { data: calculateFoodPortion(version, entry.quantity, entry.unit), error: "", loading: false };
  } catch (cause) { return { data: undefined, error: String(cause), loading: false }; }
}
