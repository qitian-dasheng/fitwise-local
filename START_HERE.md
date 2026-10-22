# 轻衡项目接手入口

更新时间：2026-10-22（Asia/Shanghai）。

**路径变更**：仓库已从 `C:\Users\21904\Documents\Obsidian\A\ai-fitness-platform` 迁到 **`C:\Users\21904\Projects\ai-fitness-platform`**（原目录被误建成了 Obsidian 库，已删除并注销）。旧路径的引用一律作废。

**0.6.0 已发布**（全量换肤 + 计划页表格化 + 信息架构 9→5 + scoped 设计守卫），先读 `design/ROADMAP_0.5.md`（M0–M4 与 M3 修正）与 `design/DESIGN_SYSTEM.md`（视觉规则）。设计令牌唯一真源是 `src/styles/tokens.css`。

这是新 AI 助手接手项目时的唯一入口。聊天摘要可能过时，源码、Git、测试和以下权威文件优先。

## 必读顺序

1. [PROJECT\_MEMORY.md](PROJECT_MEMORY.md)：当前事实、用户决定、安全边界、已知问题和下一步。
2. [FINAL\_PRODUCT\_PLAN.md](FINAL_PRODUCT_PLAN.md)：最终产品范围、业务规则、架构、路线图和验收标准。
3. `git status --short`、`git log -8 --oneline`、`git diff`：确认真实工作区状态。
4. [BUILD\_REPORT.md](BUILD_REPORT.md) 与最新的 `REVIEW_*.md`：只把有证据的测试、构建和安装结果当成已完成。
5. 仅在需要追溯时阅读 [HANDOFF.md](HANDOFF.md)、[NEXT\_PLAN.md](NEXT_PLAN.md) 和旧版阶段文档。

若旧文档与上述两份权威文件冲突，以 `PROJECT_MEMORY.md` 和 `FINAL_PRODUCT_PLAN.md` 中标注的最新结论为准，再以代码和测试复核。

## 可直接交给其他 AI 的接手提示词（2026-10-22 定稿）

> 你正在接手 Windows 本地应用"轻衡"（Fitwise Local）的开发。仓库：C:/Users/21904/Projects/ai-fitness-platform。  
> 本工作空间注入的 memory 已包含截至 2026-10-22 的开发日志；另请完整读工作空间文件 C:/Users/21904/WorkBuddy/减脂/.workbuddy/memory/2026-10-22.md（0.4.9→0.6.0 六个版本的完整记录）。聊天摘要不可信；一切以仓库文件和 Git 为准。
>
> 第一步（只读，不准写入）：
>
> 1. 读 START_HERE.md、PROJECT_MEMORY.md、design/ROADMAP_0.5.md、design/DESIGN_SYSTEM.md、HANDOFF.md、NEXT_PLAN.md；
> 2. git log -8 --oneline、git status --short（HEAD 应为 cb71053 之后，工作区干净）；
> 3. 确认产物存在：src-tauri/target/release/bundle/msi/轻衡_0.6.0_x64_zh-CN.msi（8,409,088 B）。  
>    然后用中文报告：当前版本、已完成、未完成、已知风险、你准备执行的最小阶段及验证方法。报告完等我确认再动手。
>
> 当前状态（2026-10-22，我已安装并验证 0.6.0）：
>
> - 0.6.0 = 全量换肤（theme.css 变量重映射）+ 计划页表格化 + 深链 + scoped 设计守卫；预览截图在 build-logs/visual/0.6.0-preview/。
> - 下一里程碑 0.6.1：今日页「补记一笔」区域文字问题（同一意思三遍重复 + 小字叠放），修法已记录在今日 memory 日志。
> - 待排期（优先级由我定）：①标签录入三项校验——注意 src-tauri/src/label_drafts.rs 尚无 kJ→kcal 归一化（÷4.184 只建在食材库），先补归一化再做 Atwater 交叉校验、NRV% 反推、每份/每100g 规格守卫；②设置页能量单位显示开关（kcal/kJ，默认 kcal）。
> - M3：AI 菜单草稿导入通道（授权摘要导出 + 草稿确认），本地算法后置；来源胶囊已预留。
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

- Git 分支：`main`；**最新提交以 `git log` 为准**（2026-10-22：0.7.0（M3）代码提交以 git log 为准）。
- package/Cargo/Tauri 版本：`0.8.1`（跟随里程碑编号；2026-10-22 起不再拆 0.6.x 小版本）。
- 已安装版本：**0.7.0（M3）已由用户安装并验收通过（2026-10-22，7/7）**；0.8.0 点验 2/3 过 + 发现 nrv 契约 bug 与「臃肿」反馈；**0.8.1（M4 收口：契约简化 + nrv 修复 + 三条归档项）源码/测试/文档/MSI 完成，待安装点验**——见 `REVIEW_M4.md`。无数据库迁移。
- 设计令牌唯一真源：`src/styles/tokens.css`；`theme.css` 是旧变量桥（允许清单内色值）；字体 Noto Sans SC 三档子集随包（安装包 8 MiB 量级，预期内）。
- P0 数据保全与用户正常入口重启对账已完成；不得把工具启动上下文中的另一份 8 实体库恢复进真实库。
- 下一阶段：**M4（可选深色主题 + 三条归档修复项）**，待用户下令；范围与判据见 `design/PLAN_NEXT.md` E 段（含侧栏重复设置入口的修法）。
- 内置 AI 不再是当前主线。跨 Codex、WorkBuddy、DeepSeek Harness 的连续开发先依靠同一 Git 仓库和这些文件；应用 MCP/CLI 后置为只读摘要和创建草稿接口。
