# 轻衡项目记忆（权威交接）

更新时间：2026-10-22（Asia/Shanghai）

适用对象：Codex、WorkBuddy、DeepSeek Harness 及其他后续开发助手。

隐私等级：可提交的项目记忆；不包含用户数据库、导出正文、订单号、API Key 或具体健康明细。

## 0. 0.5 设计阶段（2026-10-22，M0–M2 已完成）

- **M0**：仓库迁至 `C://Users//21904//Projects//ai-fitness-platform`；误建的 Obsidian 库 `A\` 已删除并从 obsidian.json 注销。
- **M1**：`design/DESIGN_SYSTEM.md`（规则，不抄数值）、`design/ROADMAP_0.5.md`（M0–M4 与 M3 修正）、`design/prototype/`（模板 + 生成器 `npm run design:build`）。
- **M1.5**：导航 9→5（今日/饮食/身体/运动/计划 + 工具组）；今日行动台（吃/练/称，food/workout 直达开表单）；库存归饮食、趋势归身体；AI 助手改 Ctrl+K 浮层；`src/domain/navigation.ts` + 守卫测试；移除 react-router-dom。
- **M2**：`src/styles/theme.css` 旧变量重映射全量换肤（绿色退场转近黑、阴影清零、语义色对齐、侧栏深墨底）；字号下限 11px（移动端导航 10px 例外已登记）；溢出清扫（pill/eyebrow/badge nowrap+ellipsis）；计划页表格化（删三卡/幽灵数字/覆盖进度条/两张占位卡，来源胶囊 演示/已选）；深链 `#food` 等；scoped 设计守卫 4 条（`tests/designGuard.test.ts`，全局守卫随 M2.5 旧样式退役启用）。
- **0.6.1 已出包待验收（2026-10-22，提交 `19d8a4a`）**：今日页「补记一笔」四点修法已实现——form-hint 移入页头 `.complete-day`、标题缩短为「补记一笔」、eyebrow 与「点了直接开表单」胶囊删除；前端 275 项（+1 回归）+ Rust 127 项全过，MSI 8,409,088 B（SHA-256 见 BUILD_REPORT）。挑刺与点验清单见 `REVIEW_0.6.1.md`。
- **M3 修正**：菜单来源 = 用户问 AI、AI 推荐。M3 = 授权摘要导出 + AI 菜单草稿导入通道（外部 Agent 只能建草稿、应用内确认），本地确定性算法后置；表格形态与来源胶囊（演示/AI 草稿/已选）两种来源通用。
- **待排期（用户提出，优先级由用户定）**：①标签录入三项校验——**先补 `src-tauri/src/label_drafts.rs` 的 kJ→kcal 归一化（目前 0 处 ÷4.184，只有食材库建成）**，再做 Atwater 交叉校验、NRV% 反推、每份/每100g 规格守卫；②设置页能量单位显示开关（kcal/kJ，默认 kcal）。**完整排期（0.6.1 → 0.6.2 → 0.6.3 → M3，含判据）见 `design/PLAN_NEXT.md`（2026-10-22 起为唯一排期来源）。**

## 1. 项目身份与产品方向

- 产品名：轻衡（Fitwise Local）。
- 形态：Windows 本地优先、单用户、轻量桌面应用。
- 技术：Tauri 2 + React 19 + TypeScript + Rust + SQLite。
- 核心闭环：采集或手工录入 → 草稿/核对 → 正式记录 → 饮食、体重、运动、库存与采购联动 → 趋势 → 次日计划。
- 关键价值：事实可追溯、确定性计算、本地隐私、错误可纠正；不是靠聊天机器人制造建议。
- 医疗边界：只做健康管理，不诊断、不治疗、不提供极端热量控制。

## 2. 用户已经明确的工作偏好

- 用中文协作，先给结论和证据。
- 有成熟轮子就用，不为省事重复造轮子；若需安装新软件或依赖，先说明用途并征得同意。
- 编辑器使用 Visual Studio Code；不安装完整 Visual Studio IDE。Tauri 所需的最小 C++ Build Tools 已安装。
- 每完成一个阶段必须先“挑刺”，修复或明确缺口，再给下一步计划。
- 优先让软件完整、稳定地跑起来；备份扩展、流式加密、云端 AI、动态菜单不能抢占日常可用性。
- UI 继续使用深绿、米白、金色、圆角和当前字体。可借鉴 FatSecret 的信息层级，但不复制它的老式蓝色表格皮肤。
- 食物营养资料只需首次建档/核对；以后选食物并填摄入量，由后台按规格计算。
- 标称包装量与到货实称量必须分开；库存入库后也要能补录实重、盘点与纠错。
- 同一餐的每项食物都应可更正或作废；不能因一次误录而只能重置整天。
- 不需要把内置 AI 作为主线。用户希望 Codex、WorkBuddy 或 DeepSeek Harness 可轮换维护同一项目，并共享可验证的项目记忆。

## 3. 权威源码与环境

- 仓库：`C:\Users\21904\Projects\ai-fitness-platform`（2026-10-22 从 `Documents\Obsidian\A\` 迁出：那个目录被误建成了 Obsidian 库，Obsidian 若以父目录做索引会去扫 `node_modules` 与 `target` 的几十万文件）
- 当前分支：`main`。
- 最新检查点提交：`cb71053 chore: release 0.6.0 with the new skin, plan table and design guards`（0.6.0）；此前 `41c5ccc design: reskin every surface via a legacy variable bridge`、`8ec6a20 fix: keep quick-action labels inside their buttons`（0.5.1）。
- 版本号：`package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.lock` 均为 `0.6.0`。
- 数据库 schema **v12**（`migrations/0011_measurement_conditions.sql` + `migrations/0012_workout_corrections.sql`，`domain_upgrade.rs` 硬编码 `version = 12`）；领域 envelope 持久化格式仍为 **4**。0011 只 `DROP VIEW IF EXISTS` + 重建 `domain_measurement_projection`（暴露 `measured_at` / `condition` / `day_representative`，过滤改 `COALESCE(status,'active')='active'`）；0012 用同样的 `DROP VIEW IF EXISTS` + 重建处理 `domain_workout_projection`（暴露 `status`，只留 `active`），让已更正/作废的运动退出所有查询。两份迁移都**不回填任何 payload**，否则升级对账会因 `before != after` 失败。
- Node：`C:\Program Files\nodejs\npm.cmd`
- Rust/Cargo：`C:\Users\21904\.cargo\bin\cargo.exe`，stable x86_64-pc-windows-msvc。
- 已安装：VS Code、Visual Studio 2022 Build Tools 的 VCTools 工作负载、Windows SDK、WebView2。不要安装完整 Visual Studio IDE。
- 构建目标：MSI 与 NSIS。安装包尚无代码签名证书。

常用验证命令：

```powershell
npm test
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
npm run tauri build
```

不要删除锁文件或盲目升级依赖来规避错误。真实安装版测试前先确认用户已保存并关闭轻衡；不得强制结束进程。

## 4. 代码结构速览

- `src/pages/`：今日、饮食、运动、库存、计划、趋势、收件箱、助手、设置页面。
- `src/components/`：食材库、采购/库存对话框、菜谱编辑、纠错、附件、导出与运行诊断。
- `src/domain/`：领域类型、营养换算、采购包装、菜谱、种子/空白状态等纯逻辑。
- `src/store/appStore.ts`：前端状态与领域动作入口。
- `src/data/`：桌面/浏览器持久化适配及查询。
- `src-tauri/src/domain_commands.rs`：正式领域命令与事务入口。
- `src-tauri/src/domain_store.rs`、`domain_queries.rs`、`domain_upgrade.rs`：SQLite 仓库、投影、导出与升级。
- `src-tauri/src/food_library.rs`、`inventory_ops.rs`、`meal_corrections.rs`、`recipes.rs`：关键业务服务。`inventory_ops.rs` 内含 `receive_purchase` 与 0.4.6 新增的 `correct_receipt_weight`；对应测试在模块内 `include!("inventory_correction_tests.rs")`。
- `src-tauri/src/body_commands.rs`（0.4.8）、`src-tauri/src/workout_commands.rs`（0.4.9）：体重与运动的增改作废服务，照同一范式写；`record_commands.rs` 里的 `add_workout` 刻意不搬走（`positive()` 只被它使用，搬走会变孤儿触发 clippy `dead_code`），也因此 `add_workout` 不写 `status`，旧记录靠视图里的 `COALESCE(json_extract(payload_json,'$.status'),'active')` 兜住。
- `src/domain/review.ts`（0.4.9）：阶段复盘纯函数（`buildReview` / `dayStatus` / `rollingDelta` / `rangeWeightChange` / `safeRateRange`）。**体重复盘必须在前端用全量 `state.measurements` 自算**，不能用 `period_summary`——后者只从 `start` 前回溯 6 天并丢掉更早的点，7 天预设下滚动窗口会被裁掉一半。
- `src/domain/body.ts`（0.4.10 扩充）：围度助手 `circumferenceSeries` / `circumferenceMetric` / `latestCircumference`、校验 `validateWaistInput` / `validateBodyFatInput`。**围度不套 `dailyRepresentatives`**（腰围没有「当日代表值」概念），同一天取最晚一条；区间内一次没量过返回 `null`，绝不拿区间外的数字充数。
- `src/domain/diary.ts`：`daySpan(start, end)` 算含头含尾天数，反向或非法返回 0。
- `src/domain/workouts.ts`（0.4.9 建、0.4.11 扩充）：`isActiveWorkout` 白名单、`isInactiveLabel`（含 `reverted` → 「已撤销更正」）、`validateWorkoutDraft`、`workoutDraftPayload`；0.4.11 增 `correctionParent` / `canUndoCorrection` / `canRestoreVoid` / `latestActiveWorkout` / `draftFromWorkout` / `undoHeadFor`（0.4.12：从「已更正」的旧行反查可撤销的链头，解决改过日期后新行跑到另一天、旧行无从撤回）。**更正链只认 `supersedesId` / `supersededBy` 指针，绝不从 id 前缀反推**——Rust 用 `{kind}-{commandId}`，浏览器预览用 `uid()`。
- `src/domain/meals.ts`（0.4.13 扩充）：`mealCopySource(meals, type, before)` —— 取「目标日期之前、同餐次、仍然有效」的最近一天，返回条目与按 `consumedRatio` 折算的热量（任一未知则 `null`）。Rust 侧对应 `record_commands::copy_entry`（保留营养/食材版本快照，丢掉批次与消耗事件引用）。
- `src/domain/preferences.ts`：界面偏好只存 localStorage、不进出口/备份。0.4.11 新增 `qingheng.trends.range`（单 key JSON），读取顺序固定为「parse → 形状校验 → `clampRange` → 进 state」。
- `src-tauri/src/artifacts.rs`、`upload.rs`、`label_drafts.rs`：附件、局域网上传与离线标签草稿。
- `tests/` 与 Rust 模块测试：隔离数据回归，不得写入真实用户库。

桌面正式写入必须经过 Rust 领域服务和事务。浏览器开发预览使用 localStorage，仅用于开发，不能冒充安装版持久化验证。

## 5. 当前已完成能力

- 今日仪表盘、按日期查看、饮食完整日、主观饥饿/精力。
- 食材库：名称/品牌/生熟状态、不可变营养版本、每 100g/100ml/个/份/包装及确认换算、kJ/kcal、未知/零/非零三态、收藏/最近使用、按量记餐。
- 历史餐食固定当时版本、数量、换算和营养快照；修改食材资料不回写历史。
- 标准/自定义菜谱、历史版本复用、整锅制作、原料只扣一次、分餐、剩余与浪费。
- 采购与库存：多平台、下单/到货/收货、包装层级、付款/退款、分批收货、替换、取消余单、盘点、开封、到期、退货、腐坏、FEFO。
- 库存三量结构（0.4.6-A）：标称量 `nominalAmount` / 实收 `purchasedAmount` / 余量 `remainingAmount`，`receiptBasis` 区分 `nominal`（标称估算）与 `weighed`（已称重）。收货时数量未改动即记为标称；后续可「补录实重」纠正为实称，成本与订单支出不变，只改单位成本与余量，并追加 `receipt_correction` 流水留痕。仅有唯一采购流水、且未发生退货/损耗/制作的批次才允许补录。
- 饮食单项纠错（0.4.6-A）：每行记录拆为「编辑」「作废」两个入口，编辑弹窗给出前→后差异表，作废态单独语义说明（不删食材库、不返还生鲜、不可一键恢复）。
- 饮食明细表（0.4.7）：日汇总 → 四个餐次小计 → 单项三层；列 = 食物/份量、热量、蛋白、碳水、脂肪、纤维、糖、操作，钠为可开关附加列（偏好只存 localStorage）；未知营养显示「未知」，部分未知显示「≥已知小计」，无记录显示「—」，从不当 0；每个餐次恒定保留「添加X餐」。
- 手工记餐（0.4.7）：可选填碳水/脂肪/糖/钠，留空仍为 unknown；Rust `add_meal` 对应支持四个可选键并拒绝负数。
- 身体页 / 体重记录中心（0.4.8）：独立「身体」页（导航第 3 位）。同日可多次称重且**全部保留**，不再把旧记录就地标 superseded；代表值口径 = 显式指定 > 时刻最新 > id 最大，前端 `dailyRepresentatives` 与 SQL 排序一致。字段含日期、时刻（`measuredAt`，缺省即「未标注」，不伪造）、条件（`morning`/`other`）、备注（≤200 字）；`revise_weight` 旧→superseded、`void_weight` 旧→void、`set_weight_representative` 同日唯一。守卫：20–400 kg、≤2 位小数、日期不得晚于今天、`measuredAt` 前 10 位须等于 date、不得晚于当前 +120s。趋势图虚线=每次称重、实线=七日移动平均（先按日折叠再算窗口，避免一天称三次被加权三次）。
- 饮食页结构（0.4.8）：`.food-workbench` 两栏（`minmax(560px,1.6fr)` / `minmax(340px,1fr)`），左「今日下厨」单卡、右「待处理」批次面板（无批次时虚线空态）；菜谱管理（新建/修订/另存 + 历史版本开关 + 选择标准菜谱）收进右侧 `Drawer`（z-index 90、Esc 关闭），公共 `Modal` 未改。空餐次只留一条跨列 `.diary-empty-hint`，不再铺 6–7 个破折号。
- 字号密度基准（0.4.8）：以库存页实测为准——表头 12 / 正文 12 / 主文 13 / 次要 11；饮食表、身体表均已对齐。
- 体重、运动、七日趋势、完整日均值；运动消耗不自动增加饮食额度。
- 收件箱：本地文件/文字与可信局域网上传、内容哈希、缩略图、手工隐私遮挡、回收站、分页。
- 离线营养标签草稿：手工抄录、保存/重开、核对后建档；没有 OCR 或真实 AI 请求。
- SQLite 事务、领域命令回执/请求指纹、升级前快照与对账、JSON 导出、现有加密备份/暂存恢复、Windows 凭据存储边界。
- 源码中的 P0 保护：原生 JSON 另存/回读校验、只读运行诊断、桌面桥接失败不回退浏览器存储、hydration 错误显式呈现。

截至 0.6.0 源码检查点：前端 **31 文件 274 项**、Rust **127 项**，共 **401 项** 通过；`tsc -b`、生产构建、fmt、Clippy 全目标 `-D warnings` 通过。证据见 `BUILD_REPORT.md`、`build-logs/visual/0.6.0-preview/` 与 `build-logs/*0.6.0*.log`。0.6.0 已由用户安装并验证通过（2026-10-22）。

## 6. 当前安装与数据事实（非常重要）

- 当前已安装版本为 **0.6.0**（2026-10-22 用户安装并验证）；**0.6.1 MSI 已出包、待用户覆盖安装**（今日页「补记一笔」修复，见 §0 与 REVIEW_0.6.1.md）。**无数据库迁移，schema 仍为 v12**。
- 用户真实数据已通过原生窗口导出和 Explorer 复制的数据库副本保全；副本完整性与导出逐项一致。
- 用户从 Windows Explorer 正常打开 `C:\Program Files\轻衡\fitwise-local.exe` 后，重启前后的数据库来源导出除 `exportedAt` 外完全相同，既有记录持久化验收通过。
- 电脑控制工具或命令行直接启动同一 exe/读取同名字面 AppData 路径时，会看到另一套较小数据库。这是运行上下文/文件视图差异，底层原因未完全确定。
- 后续生产验收必须通过用户正常入口或 Explorer 打开，不要用 shell、`Start-Process`、`sky.launch_app` 或开发服务器启动的实例代表用户真实库。
- 绝对禁止把工具上下文中的小数据库恢复、合并或覆盖到用户真实库。
- 某条更早的历史测量未在真实库或升级前副本中找到。用户已私下说明日期，但没有授权自动补写；接手文档不记录具体健康数值。

私有保全证据位于已被 `.gitignore` 排除的 `build-logs/data-rescue/`。它们未加密，不能提交 Git、上传云端、发给外部模型或作为测试夹具。不要移动、删除、覆盖或打开写模式。

## 7. 已知问题与产品缺口

### P0/可靠性

- P0 保护性补丁已随 **0.4.6** 发布，并在安装版上验收通过。
- 启动上下文造成两套文件视图的底层机制未定位；正常用户入口可稳定读到真实数据，但诊断流程必须继续区分来源。
- 旧导出按钮虽然实际下载文件，但反馈不明显；显式另存/回读验证已随 **0.4.6** 发布并验收。
- 不要无理由重启 Handle/Process Monitor 排查；此前 Process Monitor 从未开始捕获，已退出。

### 已随 0.4.6 安装并验收

- 库存入库后的“标称量 / 实收称重 / 当前余量”结构与补录实重流程（含盘点前的成本影响预览）已在安装版上跑过真实点击。
- 餐食单项的更正/作废入口已改为每行独立按钮并带前→后差异表，已验收。
- 两者的浏览器预览行为是 `src/domain/purchases.ts` 的镜像实现，只能证明逻辑一致；原生事务由用户在安装版上逐项点击确认。

### 仍未解决

- 只允许“唯一采购流水、未发生退货/损耗/制作”的批次补录实重；已发生后续操作的旧批次不能补录，也没有撤销上一次补录的界面入口。
- 饮食明细仍不记录**进食时刻**：`MealEntry` 只有 `createdAt`（记录时间），不能冒充进食时间；也没有排序、筛选、搜索、CSV 导出，列只能开关钠。
- 旧记录若缺 `foodSnapshot`（手记餐、熟食批次），只显示名称与份量，无法追溯来源版本。
- 运动记录（0.4.9 起）可更正/作废，但**没有撤消上一次更正的界面入口**，也没有同日多次训练的合并视图；Keep 截图仍需手工誊抄。
- 腰围与体脂（0.4.10 起）可录入、可更正、可在复盘页看区间变化，但**没有各自的趋势小图**；体脂也没有「测量方式」字段，不同设备之间不可直接比较。
- 复盘的自定义区间只在本次会话有效，切页再回来会回到 7 天预设；日历格只跳「饮食」页。
- 阶段复盘只做展示与提醒，不生成目标调整建议（原静态占位卡已删除，避免假功能）。
- 一些已录营养疑似混用 kJ/kcal。未经用户核对标签，不能自动改。仅修订食材库也不能静默更改历史餐食快照。

### 后置能力

- 动态菜单仍是演示数据，不是本地约束求解结果。
- OCR/真实 AI、Keep 截图解析、外部 MCP/CLI 尚未开放。
- 大库备份的流式内存优化、自动轮换、代码签名、长时压力及跨机器测试未完成。

## 8. 已批准的下一实施顺序

> 2026-10-22 更新：0.5 设计阶段之后的下一阶段排期以 [design/PLAN_NEXT.md](design/PLAN_NEXT.md) 为准（0.6.1 → 0.6.2 → 0.6.3 → M3）；本节保留 0.4.x 的历史实施顺序。

1. `0.4.6-A`：库存实重/盘点纠错 + 饮食单项更正/作废 + P0 保护补丁一起收口。**已完成并安装验收（出包 0.4.6）。**
2. `0.4.6-B1` → 出包 **0.4.7**：FatSecret 信息结构的轻衡风格饮食明细（三层 + 7 列 + 钠开关）+ 手工记餐补齐四项。**已随 0.4.8 覆盖安装验收。**
3. `0.4.6-B2` → 出包 **0.4.8**：体重记录中心（同日多次、两位小数、日期时间与条件、备注、修订/作废审计与历史），含 `migrations/0011` 重建测量投影视图（schema 10→11）。**已完成并安装验收。**
4. `0.4.9`：趋势页升级为阶段复盘（7/14/30 区间、达标日历、滚动周降幅、规则型提示）+ 运动记录更正/作废，含 `migrations/0012` 重建运动投影视图（schema 11→12）。口径由用户拍定：达标判定「严格区间 + 严格目标」，周降幅「滚动 7 天 vs 前 7 天」。**已完成并安装验收。**
5. `0.4.10`：进度证据补齐——腰围/体脂打通「类型→命令→镜像→表单→指标→历史→更正」整条链路，复盘页并列区间腰围、区间可自选起止日（上限 92 天）、日历格可点跳转，复盘提示带上具体日期与天数。**无数据库迁移。已安装验收通过。**
6. `0.4.11`：运动侧修补——新增 `undo_workout_correction`（原因可选、单步栈）与 `restore_voided_workout`（原因必填、只认 void 行），运动状态新增 `reverted`（已撤销更正）；「记录运动」可一键填入上次训练（不带指纹、日期不变）；复盘区间记忆（`qingheng.trends.range`）与日历跳转目标可选。**无数据库迁移。源码、369 项自动测试与 MSI 已完成，安装验收待用户执行。**
7. `0.4.12`：可用性修补——旧行也给「撤销更正」入口（`undoHeadFor`），更正/作废原因标签写明必填并加 4 个常用原因快选与灰按钮解释。**纯前端改动，无迁移。已安装验收通过。**
8. `0.4.13`：记餐提速——新增 `copy_meal` 照搬同餐次最近一天，饮食页空餐次给「照搬 MM-DD · N 项」入口与确认弹窗；**纯新增命令，无迁移。已安装验收通过。**
6. 跨 Agent 的文件/Git 接续固化（原编号 0.4.7，因版本递增反复顺延）。
7. 动态菜单：用确定性本地约束替换演示候选。
8. MCP/CLI：先只读摘要，再允许创建草稿；绝不直写正式记录。
9. 备份扩展、云端识别和其他增强在正常使用观察后再讨论。

每一阶段必须执行：实现 → 主动挑刺 → 修复/回归 → 隔离库验证 → 构建/安装版验证 → 更新本文件和下一步。不可用测试数量代替实机验收。

## 9. 外部 Agent 与共享记忆决策

- “共享记忆”的权威载体是同一 Git 仓库中的 `START_HERE.md`、本文件、`FINAL_PRODUCT_PLAN.md`、Git 历史、测试和构建日志。
- 不承诺同步各家模型的私有聊天记忆；任何助手都要先读文件并以代码复核。
- 同一时间只允许一个助手编辑主工作区。交接前提交可验证检查点或明确列出未提交文件。
- 暂不安装共享记忆服务、不自建向量数据库、不把健康数据放入记忆库。
- 安装版之外的持续开发必须修改源码、测试、构建新包；不要直接修改已安装 exe。
- 应用级 MCP/CLI 后置，只通过统一领域服务提供只读摘要和“创建草稿”；不能删除、确认正式记录、改目标、下单或直接访问 SQLite。

## 10. 权限与安全边界

- 本交接文件不扩大历史授权。恢复、合并、补写、删除、重置、覆盖安装、卸载、支付、外发图片/健康数据均需单独明确同意。
- 新依赖或软件安装先询问；用户此前仅批准过特定 C++ Build Tools、Rustup、`image` 库及限定诊断工具，不等于批准其他安装。
- 不强制结束轻衡进程，不在真实库写测试数据，不用旧程序打开新版库。
- 不提交 `build-logs/`、`node_modules/`、`dist/`、`target/`、数据库、附件、导出、凭据或用户截图。
- API Key 只存 Windows Credential Manager；不要写入 SQLite、JSON、日志、Git 或聊天。
- 未知营养不能变成零；运动消耗不抵扣饮食目标；AI/Agent 输出只能先成为草稿。

## 11. 接手助手的第一份报告

接手后不要立刻编码。先报告：

1. Git 分支、HEAD、工作区是否干净。
2. package/Cargo/Tauri 版本是否一致。
3. 当前已安装版与源码差异。
4. 你理解的下一最小阶段、不会触碰的真实数据范围、计划运行的测试。
5. 若发现本文件与代码不一致，列出证据并先更新记忆，不静默假设。
