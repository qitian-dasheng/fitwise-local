import { invoke } from "@tauri-apps/api/core";
import type { AppState } from "../domain/types";
import { flushAppStorageWrites } from "./storage";

export type DomainCommandKind =
  | "save_food_definition"
  | "revise_food_definition"
  | "set_food_favorite"
  | "record_food_meal"
  | "add_meal"
  | "add_weight"
  | "add_workout"
  | "set_checkin"
  | "set_day_complete"
  | "add_purchase"
  | "revise_purchase"
  | "close_purchase"
  | "update_purchase_payment"
  | "dispose_inventory"
  | "select_plan"
  | "add_inbox_item"
  | "set_inbox_status"
  | "set_ai_settings"
  | "record_ai_usage"
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

let commandQueue: Promise<unknown> = Promise.resolve();

// Serialize both invocation and state application, including commands from other pages.
export function enqueueDomainCommand<T>(operation: () => Promise<T>): Promise<T> {
  const result = commandQueue.then(operation);
  commandQueue = result.catch(() => undefined);
  return result;
}

const stateKeys = [
  "foodDefinitions",
  "foodDefinitionVersions",
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
  return JSON.stringify({ state: snapshot, version: 4 });
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
