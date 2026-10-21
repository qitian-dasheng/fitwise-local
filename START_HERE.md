# 轻衡项目接手入口

更新时间：2026-10-21（Asia/Shanghai）。

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

- Git 分支：`main`；本交接包生成前的最新产品检查点提交为 `d2c71dc`。
- package/Cargo/Tauri 版本：`0.4.5`。
- 已安装版本：0.4.5；源码包含尚未发布的 P0 数据诊断/导出保护补丁。
- P0 数据保全与用户正常入口重启对账已完成；不得把工具启动上下文中的另一份 8 实体库恢复进真实库。
- 下一产品阶段：库存实重/盘点纠错与饮食单项纠错；随后是轻衡风格的 FatSecret 信息结构和体重记录中心。
- 内置 AI 不再是当前主线。跨 Codex、WorkBuddy、DeepSeek Harness 的连续开发先依靠同一 Git 仓库和这些文件；应用 MCP/CLI 后置为只读摘要和创建草稿接口。
