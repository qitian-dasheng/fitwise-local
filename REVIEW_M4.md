# M4 执行记录（0.8.0：三条归档修复项）

> **状态：源码/测试/文档/MSI 完成，待安装点验。**
> 范围决策（2026-10-22，用户确认）：**深色主题取消**（当前无需求；若重启建议与 M2.5 组件拆分合并评估），
> M4 仅含三条 0.7.0 验收归档项。计划调整由用户亲自确认。

## 本轮范围（3 项，全部完成）

| # | 任务 | 交付 |
| --- | --- | --- |
| 1 | AI 草稿中文单位自动映射 | `menuDrafts.ts` `checkItem` 前置归一化：trim（含全角空格）→ 大小写宽容 → `UNIT_ALIASES` 映射（克/毫升/个/份/餐/碗/包/袋/盒/瓶/罐/箱等 → 五合法值）并**回写 basisUnit**（防「前端过、Rust 拒」假修复）；「100g」等数字粘连不剥离，报错点名「数字写 basisQuantity、单位单独写 basisUnit」；失败文案保留 `basisUnit` 字样并指向「查看草稿格式」。Rust 白名单不动（防御纵深）。授权摘要补硬性约束说明（basisUnit 五值）。 |
| 2 | 界面用词统一「食物状态」 | `FoodLibraryModal.tsx` FoodEditor 表单「计量状态」→「食物状态」，与收件箱草稿表单对齐（measurementBasis 表单标签全仓仅此两处，已核实）；tests 零命中，无需改断言。 |
| 3 | 侧栏重复「设置」入口修复 | `App.tsx` 删 `sidebar-bottom` 旧设置按钮（M1.5 前残留；工具组入口保留）+ 删 lucide `Settings` import；`styles.css` L139-142/L150 联合选择器移除 `.sidebar-bottom > button` 分支；`theme.css` 删对应死规则。 |

## 验证

| 门槛 | 结果 |
| --- | --- |
| `npx tsc -b` | ✅ 通过 |
| `npx vitest run` | ✅ **37 文件 / 314 项**（0.7.0 基线 310 + 本轮 +4：中文单位映射 4 组用例） |
| `cargo test` | ✅ **148 项**（Rust 零改动，确认不变）；`cargo fmt --check` / `clippy -D warnings` 通过 |
| `tests/designGuard.test.ts` | ✅ 4 项（theme.css 只删不加，不触白名单） |

## 版本

- package.json / tauri.conf.json / Cargo.toml：**0.7.0 → 0.8.0**。
- MSI：`src-tauri/target/release/bundle/msi/轻衡_0.8.0_x64_zh-CN.msi`，**待回填体积与 SHA-256**。
- 提交：代码与文档分开（commit 号以 git log 为准）。

## 学习记录

- 初始化 `.learnings/`（self-improving 技能），首条 [LRN-20261022-001]：点验/文档步骤必须引用界面原文标签，不能用内部术语（0.7.0 点验「计量状态 vs 食物状态」往返的直接教训）。

## 安装版点验清单（用户执行）

1. **计划页 → AI 菜单草稿**：粘贴一份 `basisUnit` 写「份」（或「克」「碗」）的草稿 JSON → 导入应成功且显示校验通过；粘贴 `basisUnit` 为「kg」或「100g」的 → 被拦，报错含「查看草稿格式」指引（「100g」还会提示数字写进 basisQuantity）。
2. **饮食页 → 添加食物 → 新建食物**：表单字段显示「**食物状态**」（不再是「计量状态」）。
3. **侧栏**：只有工具组里一个「设置」；底部只剩用户资料卡；点折叠按钮，折叠态下资料卡正常显示。
