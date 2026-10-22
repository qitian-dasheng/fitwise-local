# REVIEW_0.6.1 · 今日页「补记一笔」修复轮挑刺与验收清单

日期：2026-10-22。纯前端改动，Rust 与迁移零改动，schema 仍 v12。

## 修法（0.6.0 验收反馈的四点）

1. **form-hint 归位**：「确认前请核对所有餐次、饮料及调味料；新增餐食后需重新确认。未知热量日不进入完整日均值。」从日期条下的独立 `<p class="form-hint">` 移入页头「完成今日」区域——新容器 `.complete-day`（按钮 + 提示右对齐纵排，样式只用现有令牌，无色值无阴影）。
2. **标题去重复**：卡片标题「三件事都在这里，不用先想该去哪个页面」缩短为「补记一笔」，eyebrow「补记一笔」删除——同一意思不再出现两处。
3. **胶囊删除**：右上「点了直接开表单」胶囊删除（按钮本身就是证明）。
4. **hint 保留**：按钮内 quick-hint（照搬上次早餐 / 上次 22 分钟 / 今晨还没称）与胶囊的语义重复随胶囊删除一并消除；≤1200px 隐藏规则不变（0.5.1 既有行为）。

## 改动文件

- `src/pages/TodayPage.tsx`：页头 action 改为 `.complete-day` 容器（按钮 + form-hint）；quick-actions 卡片标题收敛；删 eyebrow 与状态胶囊。
- `src/styles.css`：新增 `.complete-day` / `.complete-day .form-hint` 两条规则（flex 纵排 + 右对齐 + max-width 460px）。
- `tests/dailyWorkflowUI.test.tsx`：新增回归用例——断言「三件事都在这里」「点了直接开表单」不再出现、`h2` 恰为「补记一笔」、卡片内无 eyebrow、form-hint 位于页头 `.complete-day` 内且不再是 `.page` 直接子级。

## 自动化证据

- 前端 **31 文件 275 项**（+1 回归用例）、Rust **127 项**（未改动，clippy/fmt 照跑通过）。
- `tsc -b`、vite 生产构建、`cargo fmt --check`、`cargo clippy --all-targets -- -D warnings` 全过。
- `tests/designGuard.test.ts` 4 条全过（未引入色值/阴影/小字号）。

## 视觉证据

真应用截图（vite dev 5199 + headless Chrome，`--virtual-time-budget=6000` 等待数据加载）→ `build-logs/visual/0.6.1-preview/`：

| 档位 | 检查点 | 结果 |
| --- | --- | --- |
| 1440×900 | 标题单行、hint 挂按钮下方右对齐、quick-hint 可见 | 通过 |
| 1366×768 | 同上，无横向滚动、无叠字 | 通过 |
| 1080×800 | hint 按 ≤1200px 规则隐藏、页头按钮+提示纵排不重叠 | 通过 |

## 安装包

| 产物 | 字节 | SHA-256 |
| --- | ---: | --- |
| `src-tauri/target/release/bundle/msi/轻衡_0.6.1_x64_zh-CN.msi` | 8409088 | `A54A3F0DDE4B12D5AAFB1772244B0ED9D8B4EDC6B18ABBEE58B2BF18B51A51F1` |

release 编译 2 分 00 秒；日志 `build-logs/tauri-build-0.6.1.log`（日志留存触发的增量重建会因 MSI 内嵌时间戳产生不同哈希，上表以磁盘最终产物为准；大小恒为 8,409,088 B）。

## 安装版验收清单（用户双击 MSI 后由 AI 在用户窗口执行）

1. 覆盖安装后关于页/窗口版本 = 0.6.1。
2. 今日页「补记一笔」卡片：标题只有一处、无 eyebrow、无右上胶囊。
3. 页头「确认该日饮食完整」按钮下方出现核对提示，文字完整不与按钮重叠。
4. 三个快捷按钮（吃了什么/练了什么/称了多少）点击仍直达对应表单。
5. 「确认该日饮食完整」原功能不变：空日禁用、确认后变绿可撤销。
6. 其余页面只看不点。
