# 轻衡项目接手入口

更新时间：2026-10-23（Asia/Shanghai）。

**路径变更**：仓库已从原 Obsidian 库内误建目录迁到 **`%USERPROFILE%\Projects\ai-fitness-platform`**（原目录已删除并从 obsidian.json 注销）。旧路径的引用一律作废。

**当前版本 0.9.0**：产品精简手术 + 重置功能修复已完成，并通过安装版 UI 验收与副本库重置验收（vitest 246 项 / cargo 86 项全过；MSI 7,086,080 B / sha256 `72cafeea…`；证据见 `RESET_ACCEPTANCE_0.9.0.md`）。历史沿革：0.6.0 全量换肤 + 计划页表格化 + 信息架构 9→5 + scoped 设计守卫；0.7.0（M3）AI 菜单草稿；0.8.1（M4）备份扩展。先读 `design/PLAN_NEXT.md`（0.6.1 → 0.9.0 全链的**历史阶段计划与执行记录**，已全部完成，非当前待办）与 `design/DESIGN_SYSTEM.md`（视觉规则）。下一阶段以用户最新决定、当前 Git 状态和最新验收报告为准。设计令牌唯一真源是 `src/styles/tokens.css`。

这是新 AI 助手接手项目时的唯一入口。聊天摘要可能过时，源码、Git、测试和以下权威文件优先。

## 必读顺序

1. [PROJECT\_MEMORY.md](PROJECT_MEMORY.md)：当前事实、用户决定、安全边界、已知问题和下一步。
2. [FINAL\_PRODUCT\_PLAN.md](FINAL_PRODUCT_PLAN.md)：最终产品范围、业务规则、架构、路线图和验收标准。
3. `git status --short`、`git log -8 --oneline`、`git diff`：确认真实工作区状态。
4. [BUILD\_REPORT.md](BUILD_REPORT.md) 与最新的 `REVIEW_*.md`：只把有证据的测试、构建和安装结果当成已完成。
5. 仅在需要追溯时阅读 [HANDOFF.md](HANDOFF.md)、[NEXT\_PLAN.md](NEXT_PLAN.md) 和旧版阶段文档。

若旧文档与上述两份权威文件冲突，以 `PROJECT_MEMORY.md` 和 `FINAL_PRODUCT_PLAN.md` 中标注的最新结论为准，再以代码和测试复核。

## 可直接交给其他 AI 的接手提示词

> 你正在接手 Windows 本地应用"轻衡"（Fitwise Local）的开发。仓库位置：%USERPROFILE%\Projects\ai-fitness-platform。
>
> 完整开发史以本仓库文件为准：PROJECT_MEMORY.md（当前事实与决定）、BUILD_REPORT.md（构建与验证记录）、design/ROADMAP_0.5.md（阶段规划）。聊天摘要不可信；一切以仓库文件和 Git 为准。
>
> 第一步（只读，不准写入）：
>
> 1. 读 START_HERE.md、PROJECT_MEMORY.md、design/ROADMAP_0.5.md、design/DESIGN_SYSTEM.md、HANDOFF.md、NEXT_PLAN.md；
> 2. git status --short --branch、git rev-parse HEAD、git log -8 --oneline（HEAD 与提交顺序以 git log 实际输出为准；工作区应干净，或只有已向用户说明的文档改动）；
> 3. 核对版本三处一致（package.json / src-tauri/Cargo.toml / src-tauri/tauri.conf.json，当前为 0.9.0），并读最新验收文档（RESET_ACCEPTANCE_0.9.0.md、BUILD_REPORT.md 顶部最新段）确认已完成范围；MSI 以最新验收报告登记的文件名与 SHA-256 为准，不假定任何旧版本产物仍在磁盘上。
>    然后用中文报告：当前版本、已完成、未完成、已知风险、你准备执行的最小阶段及验证方法。报告完等我确认再动手。
>
> 当前状态（2026-10-23，0.9.0 发布前验收已完成；GitHub 私有仓库发布准备中）：
>
> - 0.9.0 = 产品精简手术（移除库存/采购/批次/收件箱/附件/AI 配置/加密备份/计划页/标签与菜单草稿；导航 4+1；趋势并入身体页；菜谱降级为营养参考；schema v14 门闩迁移）+ 重置功能修复（保留食材库/有效菜谱/个人目标的 reset_domain_records 命令）。安装版 UI 与重置功能均已在可恢复副本上逐项验收通过。
> - 已归档里程碑：0.6.0 全量换肤/表格化/深链（预览截图 build-logs/visual/0.6.0-preview/）；0.6.1 今日页「补记一笔」文字修复；0.7.0（M3）AI 菜单草稿导入；0.8.1（M4）备份扩展（后由 0.9.0 精简移除）。
> - 下一阶段候选（优先级由我定）：GitHub 私有仓库发布（Private + Release 附件 MSI）；本地 Ollama 自然语言录入；深色主题重启；M2.5 组件拆分；备份扩展重建。
>
> 工作纪律：
>
> - 每阶段按"实现 → 挑刺 → 修复/回归 → 安装版验收 → 下一步"收口，代码与文档分开提交；
> - 设计规则见 design/DESIGN_SYSTEM.md：色值只在 src/styles/tokens.css（theme.css 是旧变量桥，允许清单内色值）；无阴影；字号下限 11px（移动端导航 10px 例外）；新层改动跑 tests/designGuard.test.ts；
> - 守卫/预览截图用真实应用：vite dev 端口 5199 + headless Chrome → build-logs/visual/，用绝对 Windows 路径；样式预览一律用系统浏览器打开，不走对话内预览面板；
> - tauri build 前在构建 shell 里 unset NODE_OPTIONS；
> - 不要读取、提交、上传或修改 build-logs/data-rescue、用户 AppData 数据库、JSON 导出、健康记录、订单截图或凭据；安装版验收不从 shell 启动应用——由我双击 MSI，你在我的正常窗口里点验；
> - 任何真实数据恢复/合并/补写/删除、覆盖安装、新依赖、外部网络服务，须先取得我明确同意；
> - 没跑的测试、构建、安装，不许声称通过；计划不许写成已完成。
>
> 边界：本任务只负责仓库与软件开发。我的饮食数据、饮食方案在本工作空间的 markdown 文件里，不碰、不问、不写入。

## 最短当前状态

- Git 分支：`main`；HEAD、最新提交及提交性质均以 `git log` 实际输出为准，不在本入口文件中固定某次提交的性质。
- package/Cargo/Tauri 版本：`0.9.0`（跟随里程碑编号）。
- **0.9.0 精简手术 + 重置功能修复已完成并通过验收（2026-10-23）**：移除库存/采购/熟食批次/收件箱/手机附件/AI 云配置/加密备份/计划页/标签与菜单草稿；导航 = 今日/饮食/身体/运动 + 设置；趋势并入身体页；菜谱降级为参考；重置改为保留食材库/有效菜谱/个人目标的 `reset_domain_records` 命令。测试：vitest 246 项 + cargo 86 项全过，clippy/fmt/生产构建通过；三场景迁移验证固化在 `src-tauri/src/migration_scenario_tests.rs`。安装版 UI 验收与重置功能副本库验收均通过（报告见 `RESET_ACCEPTANCE_0.9.0.md`；0.9.0 手术点验清单见 `REVIEW_0.9.0.md` 第 7 节）。回退点四件套（tag `v0.8.1-fallback` 等）已建立。
- 0.8.1（M4）此前已由用户安装并验收通过（3/3）；0.7.0（M3）7/7 通过。**M0–M4 路线图主线全部验收通过**。
- 数据库：schema v14（0014 精简迁移，门闩 `PRAGMA user_version`）；0001–0013 历史迁移保持原样；升级/回退判据见 `REVIEW_0.9.0.md` 第 4、6 节。
- 设计令牌唯一真源：`src/styles/tokens.css`；`theme.css` 是旧变量桥（允许清单内色值）；字体 Noto Sans SC 三档子集随包。
- 下一阶段候选（待用户规划）：本地 Ollama 自然语言录入、深色主题重启、M2.5 组件拆分、备份扩展。
- 内置 AI 不再是当前主线。跨 Codex、WorkBuddy、DeepSeek Harness 的连续开发先依靠同一 Git 仓库和这些文件；应用 MCP/CLI 后置为只读摘要和创建草稿接口。
