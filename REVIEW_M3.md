# M3 执行记录（0.7.0：AI 菜单草稿导入通道）

> 2026-10-22 用户确立阶段管理规则后，本轮为 **M3 一轮做完**：原 0.6.3（能量单位开关）并入 M3，
> 不再使用 0.6.x 小版本号；本轮成果命名 **0.7.0**。验收问题一律归档进下一阶段任务，不另开方案。

## 本轮范围（8 项，全部完成）

| # | 任务 | 交付 |
| --- | --- | --- |
| 1 | 今日页「补记一笔」贴边修复 | `.quick-actions` 补容器 padding（styles.css，数值对齐 `.meals-card` 24px）；0.6.2 安装版验收发现的缺陷，归档至本轮 |
| 2 | 设置页能量单位显示开关 | 偏好 `qingheng.display.energy-unit`（localStorage，默认 kcal）；换算系数 `KJ_PER_KCAL=4.184` 与 Rust `label_checks::KCAL_PER_KJ` 同源；应用于今日页 / 饮食页（MealDiaryTable 列头+行值+日合计）/ 食材库 / 照搬确认 / 菜谱编辑与抽屉 / 趋势页（均值+图表+日历提示）/ 计划页 / 标签草稿预览 / 运动页 / 设置页目标区间。**录入表单保持 kcal 口径，存储不变** |
| 3 | 标签预览补 NRV% 输入位 | 表单新增「NRV%（可空）」分组（7 项）；`LabelForm` 加 `#[serde(default)] nrv`（0.6.2 存量草稿兼容）；`preview_form` 解析后传入 `run_all`（0–500% 范围守卫），反推校验只在 Rust 侧执行 |
| 4 | 授权摘要导出 | `domain/aiSummary.ts` + 设置页可见的 `AiSummaryPanel`（挂在计划页）：生成 → **可编辑文本框确认** → 复制 / 保存文件（桌面走 `write_json_export` 回读校验；浏览器 Blob 下载）。只含目标/身体/近 7 天完整日均/库存剩余 + 草稿格式模板；不含密钥、审计、写入能力 |
| 5 | AI 菜单草稿导入通道 | 迁移 `0013_menu_drafts.sql`（与 0010 同构：revision 乐观锁 + status 状态机 + plan_id 回填）；`menu_drafts.rs` 三个命令 `import/confirm/discard_menu_draft`；导入时逐条菜目跑 0.6.2 同一套三项校验并存 `checks_json`；**确认要求全部通过，不能带病确认**；确认后方案带 `origin: "ai-draft"` 进 plans 集合。命令白名单三处同步（Rust / 前端镜像 / lib.rs） |
| 6 | 来源胶囊第三态 | `sourceBadge` 加 `AI 草稿（info）`；演示仍按 ID 正则；样式 `.status-pill.info`（蓝调，token 系变量） |
| 7 | 测试食物「测试」清理 | 无删除命令且不直写用户数据库；处理步骤写入下方点验清单（饮食页作废该条 24 kcal 记录；「测试」食材可在食材库继续留存，无副作用） |
| 8 | 全量回归 + 出包 | 见下表 |

## 验证

| 门槛 | 结果 |
| --- | --- |
| `npx tsc -b` | ✅ 通过 |
| `npx vitest run` | ✅ **37 文件 / 310 项**（0.6.2 基线 287 + 本轮新增 23：energyDisplay 9、energyUnitUI 4、labelDrafts NRV 1、aiSummary 4、menuDrafts 5） |
| `cargo test` | ✅ **148 项**（0.6.2 基线 138 + 本轮新增：menu_drafts 5、label_drafts NRV 5；1 项既有断言因 nrv 字段更新期望） |
| `cargo fmt --check` / `cargo clippy --all-targets -- -D warnings` | ✅ 通过 |
| `tests/designGuard.test.ts` | ✅ 4 项（padding 修复与新卡片样式均未触碰红线） |

## 明确不做（与 PLAN_NEXT §D 一致）

外部 Agent 只能建草稿，不能删改正式记录、不能改目标、不能下单、不能直写 SQLite；本地确定性算法（ROADMAP_0.5 §2.3）整体后置；生成采购草稿按钮维持禁用；起步包不在本轮范围（PLAN_NEXT §D 未列）。

## 已知边界与说明

- 计划页候选表中，AI 草稿确认出的方案默认无 `recipeVersionId`，操作列显示「待补齐标准菜谱」不可选——这是既有校验链的正确行为，不是缺陷。
- 「测试」食物清理需要用户在应用内操作（见点验清单第 6 步），AI 不直写用户数据库。
- NSIS .exe 上轮因下载断连未产出，本轮同样只出 MSI。

## 安装版点验清单（用户执行）

1. 今日页：「补记一笔」标题与三个按钮不再贴边。
2. 设置 → 显示偏好：能量单位默认 **千卡 kcal**；切到 **千焦 kJ** 后，今日页 hero、饮食页列头/日合计、趋势页、计划页表头、标签预览统一显示 kJ（300 kcal → 1255 kJ）。
3. 标签草稿：新建草稿展开「NRV% 营养素参考值」，填蛋白 30%（录入蛋白 6 g/100g）→ 保存后确认建档应被拦下（30% NRV = 18 g ≠ 6 g）；改成 10% 应通过。
4. 计划页 → 授权摘要：生成摘要 → 核对目标/库存/近 7 天数字与真实数据一致 → 补充忌口 → 复制。
5. 计划页 → AI 菜单草稿：把摘要发给外部 AI 拿回 JSON → 导入 → 看逐条校验结果；正常草稿「确认进菜单」后候选表出现 **AI 草稿** 胶囊方案；含错误能量单位的草稿确认按钮应禁用。
6. 清理点验遗留：饮食页把 10-22 早餐里「测试」（24 kcal）一条**作废**（原因可写“点验测试”）。
7. Atwater 负面用例（0.6.2 遗留）：标签草稿录三项宏量营养素齐全、能量单位选错（把 kJ 数值当 kcal）→ 确认建档应被拦下并提示核对千焦/千卡。

## 版本

- package.json / tauri.conf.json / Cargo.toml：**0.6.2 → 0.7.0**（对应里程碑 M3；此后按里程碑编号，不再拆 0.6.x 小版本）。
- MSI：`src-tauri/target/release/bundle/msi/轻衡_0.7.0_x64_zh-CN.msi`，**8,458,240 B（8.07 MiB）**，SHA-256 `3BEDE2F8DC29174849ABD522290B2FFE0B2484CD928921827E38667FDA435D5F`。
- 构建门槛实测有效：首次构建被 `tsc -b` 拦下（aiSummary 测试夹具类型错），修复后重跑通过——未跑过的构建不会假装通过。
- 提交：代码 `e10f32b` + 夹具修复 `c2639c3`，文档 `3c2975c`（分开提交）。
