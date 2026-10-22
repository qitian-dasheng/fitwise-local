# 轻衡项目接手入口

更新时间：2026-10-22（Asia/Shanghai）。

**路径变更**：仓库已从 `C:\Users\21904\Documents\Obsidian\A\ai-fitness-platform` 迁到 **`C:\Users\21904\Projects\ai-fitness-platform`**（原目录被误建成了 Obsidian 库，已删除并注销）。旧路径的引用一律作废。

**0.5 设计阶段已启动**，先读 `design/ROADMAP_0.5.md`（M0–M4）与 `design/DESIGN_SYSTEM.md`（视觉规则）；可点击样张在 `design/prototype/index.html`。设计令牌唯一真源是 `src/styles/tokens.css`。

这是新 AI 助手接手项目时的唯一入口。聊天摘要可能过时，源码、Git、测试和以下权威文件优先。

## 必读顺序

1. [PROJECT_MEMORY.md](PROJECT_MEMORY.md)：当前事实、用户决定、安全边界、已知问题和下一步。
2. [FINAL_PRODUCT_PLAN.md](FINAL_PRODUCT_PLAN.md)：最终产品范围、业务规则、架构、路线图和验收标准。
3. `git status --short`、`git log -8 --oneline`、`git diff`：确认真实工作区状态。
4. [BUILD_REPORT.md](BUILD_REPORT.md) 与最新的 `REVIEW_*.md`：只把有证据的测试、构建和安装结果当成已完成。
5. 仅在需要追溯时阅读 [HANDOFF.md](HANDOFF.md)、[NEXT_PLAN.md](NEXT_PLAN.md) 和旧版阶段文档。

若旧文档与上述两份权威文件冲突，以 `PROJECT_MEMORY.md` 和 `FINAL_PRODUCT_PLAN.md` 中标注的最新结论为准，再以代码和测试复核。

## 可直接交给其他 AI 的接手提示词

> 你正在接手 Windows 本地应用“轻衡”的源码仓库。先完整阅读根目录 `START_HERE.md`、`PROJECT_MEMORY.md`、`FINAL_PRODUCT_PLAN.md`，再检查 Git 状态、最近提交和实际代码。不要只依赖聊天摘要，也不要把计划写成已完成。不要读取、提交、上传或修改 `build-logs/data-rescue`、用户 AppData 数据库、JSON 导出、健康记录、订单截图或凭据。开始工作前，先用中文报告：当前版本、已完成、未完成、已知风险、你准备执行的最小阶段及验证方法。任何真实数据恢复、合并、补写、删除、覆盖安装、新依赖或外部网络服务都须先取得用户明确同意。每阶段必须按“实现 → 挑刺 → 修复/回归 → 安装版验收 → 下一步计划”收口。

## 最短当前状态

- Git 分支：`main`；0.4.11 检查点提交组见 `git log`（上一检查点 `a0fcb50` 为 0.4.10 收尾，更早 `31dccd4` 是 0.4.9），**最新提交以 `git log` 为准**。
- package/Cargo/Tauri 版本：`0.4.13`。
- 已安装版本：**0.4.12**（AI 在其窗口完成 10 步点验，全部通过）。0.4.13（照搬上次这一餐）源码与 **393 项**自动测试完成、MSI 已产出，**安装与点验待执行**。**无数据库迁移**，schema 仍 v12。
- P0 数据保全与用户正常入口重启对账已完成；不得把工具启动上下文中的另一份 8 实体库恢复进真实库。
- 下一产品阶段候选：①整日照搬 / 常吃组合模板；②照搬后可一键撤销整批；③同日多次运动合并视图；④腰围/体脂趋势小图。0.4.13 的安装与点验按 0.4.12 的分工执行（用户装、AI 点）。
- 内置 AI 不再是当前主线。跨 Codex、WorkBuddy、DeepSeek Harness 的连续开发先依靠同一 Git 仓库和这些文件；应用 MCP/CLI 后置为只读摘要和创建草稿接口。
