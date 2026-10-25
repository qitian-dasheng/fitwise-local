import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BodyPage } from "../src/pages/BodyPage";
import { initialState } from "../src/domain/seed";
import { useAppStore } from "../src/store/appStore";
import type { BodyMeasurement } from "../src/domain/types";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  window.localStorage.clear();
  useAppStore.setState({ ...structuredClone(initialState), measurements: [] });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

function measurement(overrides: Partial<BodyMeasurement> & { id: string }): BodyMeasurement {
  return {
    date: "2026-10-19",
    weightKg: 83,
    status: "active",
    createdAt: "2026-10-19T00:00:00Z",
    ...overrides,
  };
}

async function renderPage(measurements: BodyMeasurement[]) {
  await act(async () => {
    useAppStore.setState({ measurements });
    root.render(<BodyPage date="2026-10-19" />);
  });
}

const button = (text: string) =>
  [...host.querySelectorAll("button")].find((item) => item.textContent?.includes(text)) as HTMLButtonElement;

// 0.9.4 第二轮：历史表挂在「全部记录」标签下，历史相关用例先切标签。
async function openTab(label: string) {
  await act(async () => button(label).click());
}
const rowFor = (weight: string) =>
  [...host.querySelectorAll(".body-row:not(.body-head)")].find((item) =>
    item.textContent?.includes(weight),
  ) as HTMLElement;

it("shows an empty history instead of a blank table", async () => {
  await renderPage([]);
  await openTab("全部记录");
  expect(host.querySelector(".body-empty")?.textContent).toContain("还没有体重记录");
  expect(host.querySelectorAll(".body-row:not(.body-head)")).toHaveLength(0);
});

it("records a weigh-in with time, condition and note", async () => {
  await renderPage([]);
  const form = host.querySelector(".body-entry-form") as HTMLFormElement;
  const weightInput = form.querySelector('input[type="number"]') as HTMLInputElement;
  const timeInput = form.querySelector('input[type="time"]') as HTMLInputElement;
  const noteInput = form.querySelector(".body-entry-note input") as HTMLInputElement;
  await act(async () => {
    const setValue = (input: HTMLInputElement, value: string) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    };
    setValue(weightInput, "82.64");
    setValue(timeInput, "06:35");
    setValue(noteInput, "起床后未进食");
  });
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  const stored = useAppStore.getState().measurements;
  expect(stored).toHaveLength(1);
  expect(stored[0]).toMatchObject({ weightKg: 82.64, date: "2026-10-19", condition: "morning", note: "起床后未进食" });
  expect(stored[0].measuredAt).toBe("2026-10-19T06:35:00+08:00");
  expect(host.querySelector('[role="status"]')?.textContent).toContain("82.64");
});

it("rejects a third decimal before writing anything", async () => {
  await renderPage([]);
  const form = host.querySelector(".body-entry-form") as HTMLFormElement;
  const weightInput = form.querySelector('input[type="number"]') as HTMLInputElement;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(weightInput, "82.555");
    weightInput.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(host.textContent).toContain("两位小数");
  const submit = form.querySelector('button[type="submit"]') as HTMLButtonElement;
  expect(submit.disabled).toBe(true);
  expect(useAppStore.getState().measurements).toHaveLength(0);
});

it("renders the nine history columns and same-day badges", async () => {
  await renderPage([
    measurement({ id: "a", weightKg: 83.4, measuredAt: "2026-10-19T06:30:00+08:00", condition: "morning" }),
    measurement({ id: "b", weightKg: 82.9, measuredAt: "2026-10-19T21:10:00+08:00", condition: "other" }),
    measurement({ id: "c", date: "2026-10-18", weightKg: 83.9, measuredAt: "2026-10-18T06:40:00+08:00" }),
  ]);
  await openTab("全部记录");

  const heads = [...host.querySelectorAll(".body-head > span")].map((item) => item.textContent);
  expect(heads).toEqual(["日期", "时刻", "体重 kg", "变化", "腰围 cm", "体脂 %", "条件", "备注", "操作"]);

  const second = rowFor("82.90");
  expect(second.textContent).toContain("当日第 2 次");
  expect(second.textContent).toContain("当日代表");
  expect(second.textContent).toContain("-0.50");

  const first = rowFor("83.40");
  expect(first.textContent).not.toContain("当日代表");
  expect([...first.querySelectorAll("button")].map((item) => item.textContent)).toContain("设为代表");
});

it("keeps voided rows visible with their reason and hides them from the change column", async () => {
  await renderPage([
    measurement({ id: "a", weightKg: 83.4, measuredAt: "2026-10-19T06:30:00+08:00" }),
    measurement({ id: "b", weightKg: 90, measuredAt: "2026-10-19T09:00:00+08:00", status: "void", correctionReason: "称重时穿了鞋" }),
  ]);
  await openTab("全部记录");
  const voided = rowFor("90.00");
  expect(voided.className).toContain("body-row-inactive");
  expect(voided.textContent).toContain("已作废");
  expect(voided.textContent).toContain("称重时穿了鞋");
  expect(voided.querySelector("button")).toBeNull();
  expect(rowFor("83.40").textContent).toContain("—");
});

it("does not glue a unit onto the 「持平」 wording in the seven-day metric", async () => {
  await renderPage([
    measurement({ id: "a", date: "2026-10-15", weightKg: 83, measuredAt: "2026-10-15T06:30:00+08:00" }),
    measurement({ id: "b", weightKg: 83, measuredAt: "2026-10-19T06:30:00+08:00" }),
  ]);
  const cards = [...host.querySelectorAll(".metric-card")].map((item) => item.textContent ?? "");
  const change = cards.find((text) => text.includes("七日变化"))!;
  expect(change).toContain("持平");
  expect(change).not.toContain("持平 kg");
});

it("opens the correction dialog with a before/after diff and requires a reason", async () => {
  await renderPage([measurement({ id: "a", weightKg: 83.4, measuredAt: "2026-10-19T06:30:00+08:00" })]);
  await openTab("全部记录");
  await act(async () => rowFor("83.40").querySelectorAll("button")[0].click());

  const dialog = document.querySelector(".modal") as HTMLElement;
  expect(dialog.textContent).toContain("更正体重记录");
  expect(dialog.querySelector(".correction-diff")).toBeTruthy();
  expect(dialog.textContent).toContain("83.40 kg");

  const confirm = [...dialog.querySelectorAll("button")].find((item) =>
    item.textContent?.includes("确认更正"),
  ) as HTMLButtonElement;
  expect(confirm.disabled).toBe(true);

  await act(async () => {
    const reason = dialog.querySelector("textarea") as HTMLTextAreaElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    setter.call(reason, "秤没归零");
    reason.dispatchEvent(new Event("input", { bubbles: true }));
    const confirmed = [...dialog.querySelectorAll('input[type="checkbox"]')].find((item) =>
      item.closest("label")?.textContent?.includes("我已核对"),
    ) as HTMLInputElement;
    confirmed.click();
  });
  const enabled = [...dialog.querySelectorAll("button")].find((item) =>
    item.textContent?.includes("确认更正"),
  ) as HTMLButtonElement;
  expect(enabled.disabled).toBe(false);
});

function fieldInput(prefix: string) {
  const field = [...host.querySelectorAll(".body-entry-form label")].find((label) =>
    label.querySelector("span")?.textContent?.startsWith(prefix),
  );
  expect(field, `找不到「${prefix}」输入项`).toBeTruthy();
  return field!.querySelector("input") as HTMLInputElement;
}

function setValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function metricCard(label: string) {
  const card = [...host.querySelectorAll(".metric-card")].find((item) =>
    item.textContent?.includes(label),
  );
  expect(card, `找不到「${label}」指标卡`).toBeTruthy();
  return card as HTMLElement;
}

it("records waist and body fat when filled", async () => {
  await renderPage([]);
  const form = host.querySelector(".body-entry-form") as HTMLFormElement;
  await act(async () => {
    setValue(fieldInput("体重"), "82.64");
    setValue(fieldInput("腰围"), "92.5");
    setValue(fieldInput("体脂率"), "24.3");
  });
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });

  const stored = useAppStore.getState().measurements;
  expect(stored).toHaveLength(1);
  expect(stored[0]).toMatchObject({ weightKg: 82.64, waistCm: 92.5, bodyFatPercent: 24.3 });
});

it("leaves girth fields out entirely when they are blank", async () => {
  await renderPage([]);
  const form = host.querySelector(".body-entry-form") as HTMLFormElement;
  await act(async () => {
    setValue(fieldInput("体重"), "82.64");
  });
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });

  const stored = useAppStore.getState().measurements;
  expect(stored).toHaveLength(1);
  // 关键：留空不能落一个 0，也不能是 null 占位。
  expect("waistCm" in stored[0]).toBe(false);
  expect("bodyFatPercent" in stored[0]).toBe(false);
});

it("rejects an out-of-range waist and writes nothing", async () => {
  await renderPage([]);
  const form = host.querySelector(".body-entry-form") as HTMLFormElement;
  await act(async () => {
    setValue(fieldInput("体重"), "82.64");
    setValue(fieldInput("腰围"), "300");
  });
  expect(host.querySelector(".form-error")?.textContent).toContain("腰围需在 40–200 cm 之间。");

  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  expect(useAppStore.getState().measurements).toHaveLength(0);
});

it("shows the latest girth on the metric row with its delta", async () => {
  await renderPage([
    measurement({ id: "a", date: "2026-10-17", weightKg: 83.6, waistCm: 93.5, bodyFatPercent: 25 }),
    measurement({ id: "b", date: "2026-10-19", weightKg: 82.9, waistCm: 92, bodyFatPercent: 24.4 }),
  ]);

  const waist = metricCard("最新腰围");
  expect(waist.textContent).toContain("92.0 cm");
  expect(waist.textContent).toContain("较上次 -1.5 cm");

  const bodyFat = metricCard("最新体脂");
  expect(bodyFat.textContent).toContain("24.4%");
  expect(bodyFat.textContent).toContain("较上次 -0.6%");
});

it("falls back to a dash when only weight was ever recorded", async () => {
  await renderPage([measurement({ id: "a", date: "2026-10-19", weightKg: 82.9 })]);
  expect(metricCard("最新腰围").textContent).toContain("还没有腰围记录");
  expect(metricCard("最新体脂").textContent).toContain("还没有体脂记录");
});

it("shows the 14-day placeholder copy when no weigh-in exists", async () => {
  await renderPage([]);
  expect(host.querySelector(".empty-chart")?.textContent).toContain("近 14 天还没有称重记录");
});

it("draws the trend from a single weigh-in instead of hiding the chart", async () => {
  await renderPage([measurement({ id: "only", date: "2026-10-18", weightKg: 83.2 })]);
  expect(host.querySelector(".empty-chart")).toBeNull();
});

it("keeps the page shell while the desktop trend query is pending", async () => {
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
    invoke: () => new Promise(() => {}),
  };
  await renderPage([]);
  expect(host.querySelector(".body-entry-form")).toBeTruthy();
  expect(host.querySelector(".empty-chart")?.textContent).toContain("正在读取本地体重记录");
});

it("follows the diary date while the entry form is untouched", async () => {
  await act(async () => {
    root.render(<BodyPage date="2026-10-18" />);
  });
  const dateInput = () => host.querySelector('.body-entry-form input[type="date"]') as HTMLInputElement;
  expect(dateInput().value).toBe("2026-10-18");
  await act(async () => {
    root.render(<BodyPage date="2026-10-16" />);
  });
  expect(dateInput().value).toBe("2026-10-16");
});

it("keeps the original date once the form has input", async () => {
  await act(async () => {
    root.render(<BodyPage date="2026-10-19" />);
  });
  const weightInput = host.querySelector('.body-entry-form input[type="number"]') as HTMLInputElement;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(weightInput, "82.5");
    weightInput.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    root.render(<BodyPage date="2026-10-15" />);
  });
  const dateInput = host.querySelector('.body-entry-form input[type="date"]') as HTMLInputElement;
  expect(dateInput.value).toBe("2026-10-19");
});
