# 轻衡 · Fitwise Local

本地优先的个人减脂管理桌面应用（Windows）。无账号、无云端、无遥测，数据全在本机 SQLite。

## 下载与安装

从 [Releases](https://github.com/qitian-dasheng/fitwise-local/releases) 下载最新安装包：

- **0.9.3 起**：`FitwiseLocal_x.x.x_x64-setup.exe`（NSIS 安装程序，按用户安装，通常无需管理员权限；应用内置自动更新）
- **0.9.2（当前 Release）**：`FitwiseLocal_0.9.2_x64_zh-CN.msi`（Windows Installer）
- **0.9.2 → 0.9.3 升级**：请先在「设置 → 应用」中卸载 0.9.2（MSI），再安装 0.9.3 exe；卸载不会删除你的记录数据（数据存于独立目录，与安装无关）
- 校验：每个 Release 附 SHA-256，安装包名均为 ASCII

## 隐私声明

- **完全离线**：当前版本不发起任何网络请求，无遥测、无统计、无崩溃上报
- 数据仅存于本机（SQLite 单库），应用不内置任何导出/同步到第三方的通道；JSON 导出由你手动触发
- 0.9.3 起唯一的网络行为将是**版本更新检查**（可在设置中关闭），详见该版发布说明

- **接手开发**：先读 [START_HERE.md](./START_HERE.md)（唯一权威接手文档，含架构、纪律、问题台账）。
- **日常使用**：见 [DAILY_USAGE.md](./DAILY_USAGE.md)。
- **版本记录**：`docs/releases/`（每版一份）；历史阶段文档在 `docs/history/`。

## 当前能力（0.9.2）

- **今日**：「还能吃 X–Y」预算主数字、连续记录天数、餐次热量份额、主观状态、完成日确认。
- **饮食**：常吃栏一键记餐（按上次份量）、待确认篮子批量写入、照搬任意历史日、菜谱缩放入餐、仅记录本次；逐行编辑/作废带前后差异。
- **食材库（独立页）**：全页两栏建档表单、不可变营养版本、归档、未引用可删、名称纠错；记餐选择器与建档页往返时篮子不丢。
- **身体**：同日多次称重、代表值、目标线、14 天体重趋势 + 7 日均线、腰围/体脂迷你趋势；更正/作废全留审计。
- **运动**：手工记录、更正/撤销/恢复、Keep 截图誊抄去重。
- **复盘**：区间均值、达标日历、滚动周降幅；未完整日不按 0 摊薄。
- **目标可编辑**：热量区间/蛋白/纤维/目标体重，版本化审计（`set_target_profile`）。
- **数据**：SQLite 单库、领域命令事务+幂等回执+请求指纹、升级前快照对账回滚、JSON 导出（schemaVersion 实读 `user_version`）。

## 技术栈与开发

Tauri 2 + React 19 + TypeScript + Rust（rusqlite）。前端状态 zustand，领域命令经 `execute_domain_command` 白名单分发，前端不直接执行 SQL。

```powershell
npm install
npm test        # vitest（含 docsGuard/designGuard 守卫）
npm run dev     # 浏览器预览（不含桌面事务能力）
npm run tauri dev / npm run tauri build   # 桌面版（工具链见 START_HERE §4）
```

Rust 侧：`cargo test/fmt/clippy --manifest-path src-tauri/Cargo.toml`。命令白名单与迁移门闩（`user_version`）由守卫测试冻结。

## 边界

- 本产品不是医疗器械，不提供诊断、治疗或极端热量控制建议。
- 未知营养不当作 0；历史记录不可变版本快照；运动消耗不抵扣饮食目标。
- AI 采集通道（本地 Ollama 优先）规划于 0.10，当前未接入；所有记录均可完全手工完成。

## 第三方许可

内置 Noto Sans SC 字体子集，声明见 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。
