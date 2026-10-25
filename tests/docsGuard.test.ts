/// <reference types="node" />
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * 文档守卫（0.9.2 起）：把"文档不漂移"变成测试，不靠自觉。
 * 1. 根目录 md 上限——文档不许再繁殖；
 * 2. 活文档的相对 md 链接必须指向真实文件——杀死悬空引用；
 * 3. 版本号五处一致（含 START_HERE 的当前版本声明）——文档与代码不再各说各话。
 */

const LIVING_DOCS = ["README.md", "START_HERE.md", "DAILY_USAGE.md", "AGENTS.md"] as const;
/** 根目录允许的 md 上限：README/START_HERE/DAILY_USAGE/AGENTS/THIRD_PARTY_NOTICES + 1 个余量。 */
const ROOT_MD_LIMIT = 6;

const read = (file: string) => readFileSync(file, "utf8");

describe("文档守卫（docsGuard）", () => {
  it(`根目录 md 不超过 ${ROOT_MD_LIMIT} 份（含未跟踪文件）`, () => {
    const root = readdirSync(".").filter((name) => name.endsWith(".md"));
    expect(root.length, `根目录出现 ${root.join("、")}`).toBeLessThanOrEqual(ROOT_MD_LIMIT);
  });

  it("活文档中的相对 md 链接必须指向真实存在的文件", () => {
    for (const doc of LIVING_DOCS) {
      const links = [...read(doc).matchAll(/\]\(([^)]+\.md[^)]*)\)/g)].map((match) => match[1].split("#")[0]);
      for (const link of links) {
        if (/^[a-z]+:\/\//i.test(link)) continue;
        expect(existsSync(link), `${doc} 引用了不存在的文件：${link}`).toBe(true);
      }
    }
  });

  it("版本号五处一致：package.json / tauri.conf.json / Cargo.toml / Cargo.lock / START_HERE", () => {
    const version = (JSON.parse(read("package.json")) as { version: string }).version;
    expect(read("src-tauri/tauri.conf.json"), "tauri.conf.json 版本不一致").toContain(`"version": "${version}"`);
    expect(read("src-tauri/Cargo.toml"), "Cargo.toml 版本不一致").toMatch(new RegExp(`^version = "${version}"`, "m"));
    expect(
      read("src-tauri/Cargo.lock"),
      "Cargo.lock 中 fitwise-local 版本不一致",
    ).toMatch(new RegExp(`name = "fitwise-local"\\r?\\nversion = "${version}"`));
    expect(read("START_HERE.md"), "START_HERE 未声明当前版本").toContain(version);
  });
});
