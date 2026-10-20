import { invoke } from "@tauri-apps/api/core";
import type { AppState } from "../domain/types";
import { flushAppStorageWrites } from "./storage";

export type DomainCommandKind =
  | "prepare_recipe"
  | "consume_batch"
  | "discard_batch"
  | "receive_purchase"
  | "adjust_inventory";

export interface DomainCommandResponse<TResult = Record<string, never>> {
  applied: boolean;
  replayed: boolean;
  revision: number;
  result: TResult;
  state: AppState;
}

const stateKeys = [
  "profile",
  "meals",
  "checkIns",
  "measurements",
  "workouts",
  "recipes",
  "batches",
  "consumptionEvents",
  "wasteEvents",
  "auditEvents",
  "inventory",
  "inventoryMovements",
  "purchases",
  "inbox",
  "plans",
  "aiSettings",
] as const satisfies readonly (keyof AppState)[];

function serializeBootstrapState(state: AppState) {
  const snapshot = Object.fromEntries(stateKeys.map((key) => [key, state[key]])) as unknown as AppState;
  return JSON.stringify({ state: snapshot, version: 3 });
}

export async function executeDomainCommand<TResult>(
  state: AppState,
  commandId: string,
  kind: DomainCommandKind,
  payload: Record<string, unknown>,
) {
  await flushAppStorageWrites();
  return invoke<DomainCommandResponse<TResult>>("execute_domain_command", {
    request: {
      commandId,
      kind,
      payload,
      bootstrapState: serializeBootstrapState(state),
    },
  });
}
