import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
import { usePeriodSummary, type PeriodSummary } from "../src/data/domainQueries";

let root: Root | undefined;
let container: HTMLDivElement | undefined;
afterEach(async () => { if (root) await act(async () => root!.unmount()); container?.remove(); delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__; vi.restoreAllMocks(); });
function View({ date }: { date: string }) {
  const result = usePeriodSummary(date, date);
  return <div>{result.loading ? "读取中" : result.data?.start ?? result.error}</div>;
}
it("does not display a previous day's result while the newly selected date is loading", async () => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
  let resolve!: (data: Partial<PeriodSummary>) => void;
  invoke.mockResolvedValueOnce({ start: "2026-10-19" }).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => root!.render(<View date="2026-10-19"/>));
  expect(container.textContent).toBe("2026-10-19");
  await act(async () => root!.render(<View date="2026-10-20"/>));
  expect(container.textContent).toBe("读取中");
  await act(async () => resolve({ start: "2026-10-20" }));
  expect(container.textContent).toBe("2026-10-20");
});
