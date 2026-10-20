import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { AppState } from "../src/domain/types";
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
import { initialState } from "../src/domain/seed";
import { useAppStore } from "../src/store/appStore";

beforeEach(() => {
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  useAppStore.setState(structuredClone(initialState));
  invoke.mockReset();
  Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
});
afterEach(() => { delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__; });

describe("desktop command transport", () => {
  it("serializes cross-page writes and applies the first result before the next bootstrap", async () => {
    const seen: string[] = [];
    invoke.mockImplementation(async (command: string, args: { request: { kind: string; bootstrapState: string } }) => {
      expect(command).toBe("execute_domain_command");
      const state = JSON.parse(args.request.bootstrapState).state as AppState;
      seen.push(args.request.kind);
      if (args.request.kind === "add_weight") {
        await new Promise((resolve) => setTimeout(resolve, 15));
        state.measurements.push({ id: "saved-weight", date: "2026-10-20", weightKg: 82, createdAt: "2026-10-20T00:00:00Z" });
      } else {
        expect(state.measurements.at(-1)?.id).toBe("saved-weight");
        state.workouts.push({ id: "saved-workout", date: "2026-10-20", name: "有氧", type: "有氧", durationMinutes: 22, createdAt: "2026-10-20T00:00:00Z" });
      }
      return { applied: true, replayed: false, revision: seen.length, state, result: {} };
    });
    await Promise.all([
      useAppStore.getState().addWeight(82, "2026-10-20", "weight-command-01"),
      useAppStore.getState().addWorkout({ date: "2026-10-20", name: "有氧", type: "有氧", durationMinutes: 22 }, "workout-command-1"),
    ]);
    expect(seen).toEqual(["add_weight", "add_workout"]);
    expect(useAppStore.getState().workouts.at(-1)?.id).toBe("saved-workout");
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it("preserves local state on failure and allows a following command to run", async () => {
    const before = useAppStore.getState().measurements;
    invoke.mockRejectedValueOnce(new Error("database unavailable"));
    const failed = await useAppStore.getState().addWeight(82);
    expect(failed.error).toContain("database unavailable");
    expect(useAppStore.getState().measurements).toBe(before);
    invoke.mockResolvedValueOnce({ applied: true, replayed: false, revision: 1, result: {}, state: structuredClone(initialState) });
    expect(await useAppStore.getState().setCheckIn({ energy: 3 })).toEqual({});
  });
});
