import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import App from "../src/App";
import { useAppStore } from "../src/store/appStore";
import { reportStorageFailure } from "../src/data/storage";

it("shows a failed hydration explicitly instead of an endless loading screen or sample diary", async () => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const hydration = vi.spyOn(useAppStore.persist, "hasHydrated").mockReturnValue(false);
  const scroll = vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  reportStorageFailure("读取仓库失败：测试故障");
  try {
    await act(async () => root.render(<App/>));
    expect(host.textContent).toContain("本地记录未能安全打开");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("测试故障");
    expect(host.textContent).not.toContain("正在打开轻衡");
    expect(host.textContent).not.toContain("添加食物");
  } finally {
    await act(async () => root.unmount()); host.remove(); hydration.mockRestore(); scroll.mockRestore(); reportStorageFailure("");
  }
});
