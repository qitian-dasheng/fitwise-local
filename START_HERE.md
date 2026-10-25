# 轻衡（Fitwise Local）· 接手须知

> **更新时间**：2026-10-26（0.10.0 发布轮）
> **适用对象**：接手本项目的 AI 助手或开发者
> **读法**：先读完本文件，再用 `git log` 与代码复核，最后才动代码。本文件中的"实测"项均为当次只读核查所得，可直接采信；标"需实测"的项必须自己验证。

---

## 0. 30 秒速览

| 项 | 内容 |
|---|---|
| 是什么 | Windows 本地优先的个人营养/饮食/体重/运动记录桌面应用。无账号、无云端、无遥测，数据全在本机 SQLite |
| 技术栈 | Tauri 2 + React 19 + TypeScript 5.7 + Rust + SQLite（rusqlite） |
| 当前版本 | **0.10.0**（功能版：食物柜轻量版 + 菜谱餐次分组 + 分离式记餐 + 六项实机修复；零迁移。基线 0.9.3 已发 Release 含 exe 与自动更新） |
| 产品原则 | 事实可追溯、确定性计算、本地隐私、错误可纠正。**不是**聊天机器人式建议 |
| 医疗边界 | 只做健康管理，不诊断、不治疗、不提供极端热量控制 |
| 你该做的第一件事 | 不要编码。先按第 9 节写"接手报告" |

---

## 1. 当前事实（2026-10-26 · 0.10.0 发布轮）

| 项 | 值 |
|---|---|
| 仓库 | 本机克隆目录（仓库根 = README 所在目录；公开仓库不再写绝对路径） |
| 远端 | `https://github.com/qitian-dasheng/fitwise-local.git`（公开） |
| 当前分支 | `dev/0.9.4`（分支名沿用立项号；0.10.0 全部工作在此）；`main` 与 origin 同步于 0.9.3 发布态 |
| 工作树 | 干净；仅 `GITHUB_RELEASE_REVIEW.md` 未跟踪（**故意不提交**，是 0.9.0 时期的旧审查报告） |
| tag | `v0.8.1-fallback`、`v0.9.0`、`v0.9.1`、`v0.9.2`、`v0.9.3`（均已推送）；`v0.10.0` 验收通过后打 |
| Release | **轻衡 0.9.3**（Latest，exe+.sig+latest.json）、轻衡 0.9.2（MSI 保留作回退）、更早归档 |
| 版本号一致性 | 基线 0.9.1；0.9.2 发布时四处同步升级并须通过 `tests/docsGuard.test.ts`（含 START_HERE 版本声明） |
| 数据库 schema | **v14**（`PRAGMA user_version`，14 个迁移 `0001`–`0014`）。**0.9.2/0.9.3/0.10.0 均为零迁移版本**（0.10.0 食物柜为 JSON 信封新集合 `pantryItems`，非 SQL 表） |
| 领域持久化格式 | **v4** |
| 已安装版本 | 0.9.3（NSIS exe，按用户安装；0.9.4 起经应用内自动更新升级） |
| 数据目录 | `%APPDATA%\cn.fitwise.local\`（当前仅 `fitwise.db`，约 300 KB） |
| 测试规模 | Rust **112** 项 / 前端 **323+** 项（含 docsGuard/designGuard/stylesGuard 守卫；以 0.9.4 全量为准） |
| 安装包归档 | `D:\FitwiseBackup\installers\`（0.9.0 与 0.9.1 的 MSI，哈希与验收记录一致） |
| 文档结构 | 根目录跟踪 md 仅 5 份（README / START_HERE / DAILY_USAGE / AGENTS / THIRD_PARTY_NOTICES）；发布记录 `docs/releases/`，历史文档 `docs/history/`；docsGuard 冻结上限 |

**0.9.1 发布时的一个关键事实**：发布的 MSI 就是用户实际安装验收过的那一个二进制（`SHA-256 = cdebbe1796908a0d1bad67e178c150e14059aa99d2016a308fee62a7b008b1bd`，7,114,752 B）。Rust + WiX **不是可复现构建**，重新构建会产生不同哈希。若将来需要重新发版，请在发布说明里更新哈希，不要声称"同一构建"。

---

## 2. 硬约束（违反即停）

### 2.1 数据

- **绝不**读取、复制、哈希、修改、迁移或删除用户的真实数据库（`%APPDATA%\cn.fitwise.local\`），除非用户单独明确授权。
- 任何功能验证只能用**独立临时库 + 虚构数据**。
- 升级前必须：应用完全退出 → 整目录冷备份 → 记录 `fitwise.db` 字节数与哈希。WAL 模式下运行中拷贝会丢最后几条记录。
- **升级兼容 ≠ 降级支持**。若改动数据结构，必须分别验证「新版读旧数据」与「回退旧版后数据仍可用」。
- 不得重置数据库、清空旧数据、要求用户重新录入。

### 2.2 领域不变量

- **未知营养不是 0**。三态：未知 / 明确为 0 / 非零。UI 显示「未知」或「≥已知小计」。
- 历史记录固定当时的营养版本与快照；修改食材或菜谱资料**不得**回写历史摄入。
- 更正/作废产生可审计的修订链（`supersedesId` / `supersededBy` 指针），**绝不从 id 前缀反推**。
- 已被引用的食材不可级联删除（会拒绝并说明原因）。
- 运动消耗**不**抵扣饮食目标。

### 2.3 Git 与发布

- 不删除 tag、Release、历史提交、既有 MSI。
- 不 force push；不重写历史（除非用户明确要求并为转公开做准备）。
- 发布前确认：版本号四处一致 → 测试全绿 → MSI 哈希与验收记录一致。

### 2.4 已明确排除、不要重新引入

0.9.0 是一次**产品精简手术**，已删除：库存、采购、批次/熟食、收件箱与移动上传、附件与隐私遮挡、AI 云配置、加密备份、计划页与次日菜单、标签草稿、菜单草稿。前端删 19 个文件、后端删 8 个 Rust 模块。

**边界更新（2026-10-25 用户批准，0.9.4 已实现）**：库存以**轻量版「食物柜」**落地——实现为 JSON 信封第 9 集合 `pantryItems`（**非 SQL 表、零迁移**，取代立项时“新表+迁移 v15”的设想）、命令信封 CRUD、只读缺货提示、零成本账，**不恢复**旧的成本/采购/批次体系。其余排除项维持不变，仍不要自行恢复。

### 2.5 协作

- 用中文。
- 不安装新软件/依赖而不先说明用途并取得同意。
- 不用命令行走廊启动生产 exe 做持久化验证（见第 7 节陷阱）。
- 每阶段：实现 → 主动挑刺 → 修复/回归 → 隔离库验证 → （授权后）安装版验证 → 更新记忆与下一步。

---

## 3. 技术架构（真实结构，以此为准）

### 3.1 前端 `src/`

| 目录 | 内容 |
|---|---|
| `pages/` | 7 页：`TodayPage` `FoodPage` `BodyPage` `WorkoutPage` `TrendsPage`(嵌于身体页) `SettingsPage` `FoodLibraryPage`(0.9.2 新增，工具分组) |
| `components/` | 16 个：食材库弹窗、菜谱编辑/管理抽屉、菜谱入餐草稿、照搬弹窗、各类更正弹窗、营养环、日历、趋势仪表等 |
| `domain/` | 17 个纯逻辑模块：`nutritionDisplay` `foodLibrary` `meals` `body` `workouts` `review` `diary` `preferences` `navigation` `todayHints` `energyDisplay` `privacy` `resetState` `recipes` `seed` `time` `calculations` |
| `store/appStore.ts` | 前端状态与领域动作入口（zustand） |
| `data/` | `domainCommands`（命令构造）、`domainQueries`、`foodLibrary`、`storage`（桌面/浏览器适配） |
| `styles/` | `tokens` `theme` `base` `fonts` + `styles.css` |

### 3.2 后端 `src-tauri/src/`

**功能模块（12）**：`domain_commands`（命令白名单与分发）、`domain_store`（SQLite 仓库、迁移门闩）、`domain_queries`（投影查询、JSON 导出）、`domain_upgrade`（升级快照/对账/回滚）、`food_library`、`food_management`（在 `food_library.rs` 内）、`meal_corrections`、`recipe_meal_commands`、`recipes`、`record_commands`、`body_commands`、`workout_commands`、`data_diagnostics`

**测试接线（重要，2026-10-25 纠正）**：独立的 `*_tests.rs` 文件由 `domain_commands.rs` 内 `mod tests { include!("xxx_tests.rs"); ... }` **include! 宏**接入（六个文件：body/workout/meal_copy/recipe_meal/food_management/upgrade_compat + 0.9.2 新增 target_profile），共享 `connection()/request()/bootstrap()` 辅助函数；`lib.rs` 只声明 `domain_reset_tests` 与 `migration_scenario_tests` 两个独立 mod。**新增命令测试：建独立 `xxx_tests.rs` 文件 + 在 include! 列表追加一行**，不要往 lib.rs 加 mod（会被当成孤儿忽略——曾因此误判删除，编译器救回，见 git 历史 2337fe5/5ff7210）。

### 3.3 命令通道（三层，必须同步改）

Tauri 命令只有 **13 个**（`lib.rs::generate_handler`）。真正的业务命令走 `execute_domain_command`，其 `commandKind` 白名单当前 **27** 种，包括：

```
add_meal  revise_meal  void_meal  copy_meal  record_food_meal  record_recipe_meal
add_weight  revise_weight  void_weight  set_weight_representative
add_workout  revise_workout  void_workout  undo_workout_correction  restore_voided_workout
save_food_definition  revise_food_definition  set_food_archived  delete_food
correct_food_identity  set_food_favorite
save_recipe_version  set_checkin  set_day_complete  set_target_profile
```

**新增一个命令必须同一次提交改四处**：
1. `src-tauri/src/domain_commands.rs` 白名单（两处：只读集合 + 写入集合）
2. Rust 侧实现模块
3. `src/data/domainCommands.ts` 的 `DomainCommandKind` 联合类型
4. `src/domain/types.ts` 的载荷类型

漏掉任何一处，类型或白名单会不一致。

### 3.4 数据库

- 迁移门闩在 `domain_store.rs`：读 `PRAGMA user_version`，`< 14` 时重放 `0001`–`0013`，再跑 `0014`，然后置 14。
- `0001`–`0013` **一字未改**；`0002` 的 ALTER 带「`prepared_batches` 表存在才跑」守卫（该表被 0014 删除，不可重放）。
- `0014_drop_deprecated.sql` 是**破坏性迁移**：DROP 22 表 + 4 视图 + 2 索引 + DELETE 8 个废弃集合 + `aiSettings` 单例。**它已在 0.9.0 执行过**，0.9.0→0.9.1 不会触发。
- 运行期视图 `domain_active_meal_projection`（0009）**不在**删除清单，勿误删。
- `migration_scenario_tests.rs` 里有守卫测试冻结 SQL 对象清单（7 表 / 4 视图 / 2 索引）与 `user_version = 14`。**改动 schema 会让它失败——这是设计意图**，别去改测试来绕过。

---

## 4. 构建与验证

工具链（已验证，无需完整 Visual Studio IDE）：VS Code、Rust stable `x86_64-pc-windows-msvc`、VS 2022 Build Tools（VCTools）、Windows SDK、WebView2。

```powershell
npm test                                    # vitest，预期 269 通过 / 34 文件
npm run build                               # tsc -b + vite build，预期 0 错误
cargo test --manifest-path src-tauri/Cargo.toml        # 预期 102 通过
cargo fmt  --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
npm run tauri build                         # 产出 MSI + NSIS，约 4 分钟
```

**重要**：首次构建前若 `src-tauri/target` 已被清空，release 全量编译需要 **20–40 分钟**（2026-10-25 该目录曾被清理以回收 55.6 GB）。

`dist/`、`node_modules/`、`src-tauri/target/`、`build-logs/` 全部被 `.gitignore` 排除，不入库。

---

## 5. 问题台账（OBS-001 ~ OBS-016）

> 这份表格是 **2026-10-25 用源码核实后的结果**，比《轻衡问题台账与版本处理总览.md》更新。
> 该台账写于 0.9.1 候选验收阶段，把 OBS-005/006 标为"建议、未确认"——**实际 0.9.1 已全部落地**，以此表为准。

| 编号 | 现象 | 0.9.1 实际状态 | 核实依据 / 说明 |
|---|---|---|---|
| OBS-001 | 目标热量/蛋白/纤维不可编辑 | ✅ **0.9.2 已实现** | `set_target_profile` 命令 + 设置页编辑表单；旧值进审计（`target_profile_updated`） |
| OBS-002 | 目标区间(1700–1900) vs 环图单值(1800) | ✅ **0.9.2 已实现** | 热量环分母显示区间（`rangeLabel`），进度仍以 target 为基准 |
| OBS-003 | 能量单位选择器独占整行 | ✅ **0.9.2 已实现** | 食材库全页表单中能量单位与数据来源并排（`FoodEditor` layout="page"） |
| OBS-004 | 营养字段缺钙/铁/钾 | **仍存在（0.9.3）** | 食材表单仍是 7 字段：能量/蛋白/碳水/脂肪/纤维/糖/钠 |
| OBS-005 | 修订页无法改食物状态 | ✅ **已实现** | `correct_food_identity` 命令（`domain_commands.rs`）；生熟状态更改会拒绝并引导新建 |
| OBS-006 | 食材库无法删除 | ✅ **已实现（0.9.2 迁至食材库页）** | `delete_food` + `set_food_archived`；未引用可永久删除（同事务引用扫描 + 级联 + 审计），已引用可归档/恢复 |
| OBS-007 | 菜谱无法加入餐次 | ✅ **已实现** | `record_recipe_meal` + `RecipeMealDraftModal`；支持 ×0.5/×1/×2/自定义缩放，钉住菜谱版本并写 `recipeVersionId` |
| OBS-008 | 逐项添加繁琐 | ✅ **0.9.2 再提速** | 篮子之上新增常吃栏（一键按上次份量入篮）+ 选择器按「上次」预填 |
| OBS-009 | 营养小数位过多（`507.8472275334608`） | ✅ **已实现** | `nutritionDisplay.ts` 的 `nutrientLabel` + `toFixed`；**仅展示层截断，存储精度不变** |
| OBS-010 | 菜谱管理是 flat 下拉，不符餐次习惯 | ✅ **0.9.4 已实现** | 菜谱 `mealTags`（早餐/午餐/晚餐/加餐多选）+ 管理抽屉按餐次筛选与分组下拉（未分类兜底）；用户确认长期菜谱会变多 |
| OBS-011 | 单位 `piece` 未中文化 | ✅ **已实现** | `foodUnitLabels = { g:"克", ml:"毫升", piece:"个", serving:"份", package:"包装" }`；另有 `normalizeAmountLabel` 归一化历史纠错文案里的英文单位 |
| OBS-012 | 日合计区 UI 层级混乱 | **待实机观察** | 0.9.2 验收时观察驱动修复 |
| OBS-013 | 七日体重趋势图空白 | ✅ **0.9.2 代码已修，待实机终验** | 根因：14 天窗口 + 单点即绘制；空态文案区分「一次称重/无记录」。此前 7 天窗口对一周一称用户永远只有 1 点 |
| OBS-014 | 14 天热量图空白 | ✅ **0.9.2 代码已修，待实机终验** | 图下注释列明被排除天数与原因；全排除时空态点名「N 天热量不全」；loading/error 不再塌缩整页 |
| OBS-015 | 顶部记录日期与称重日期不联动 | ✅ **0.9.2 已实现** | 空表单跟随顶部日记日期（未输入时不打断） |
| OBS-016 | 长期食材库存管理（新需求） | ✅ **0.9.4 已实现（食物柜轻量版）** | 信封集合 `pantryItems` + `pantry_commands`（入库±/更新/删除）；食材库页第五分组；菜谱行缺货只读提示；重置随食材库保留、导出含该集合（见第 11 节） |

### 版本路线（2026-10-25 与用户对齐）

- **0.9.2（进行中）**：图表根因修复、目标可编辑、食材库拆页、记餐提速、借鉴五件、文档三层包、UI 三版风格原型定向。零迁移。
- **0.9.3**：驾驶舱一屏化逐页迁移（五主页面 1080p 页面不滚/面板内滚）+ 双主题 tokens（`data-theme` 浅/深，按 0.9.2 原型选定向）+ OBS-004 营养字段 + OBS-010 问询 + 两套数据库诊断增强（候选）。
- **0.10.0（已交付，含第六/七轮浏览器复查迭代）**：实机反馈六项修复（深色根治/M2.5 旧样式退役/身体页缩短/饮食页菜谱压行/设置行+弹窗/搜索图标对齐）+ 库存轻量版（第 11 节）+ OBS-010 菜谱餐次分组。零迁移。
- **0.10.0**：AI 采集通道（本地 Ollama 优先，草稿不入账；用户机器 Ollama 已就绪）。
- **0.10.x 常见食材库（2026-10-26 用户批准，与 AI 采集同批排期）**：应用内置策划收录的常见食材目录（首版 200–500 项基础食材+常见包装食品，随版本扩充，来源 `catalog` 与个人食材区分，个人修改不覆盖目录更新）；**人工收录制**——用户手动导出食材文件发维护者审核进官方目录，**不做自动上传**（守住「更新检查是唯一网络行为」的隐私承诺）。

---

## 6. 文档结构与可信度（2026-10-25 收敛后）

**结构规则（docsGuard 测试冻结）**：根目录跟踪 md ≤ 6；活文档的相对 md 链接必须指向真实文件；版本号五处一致（package.json / Cargo.toml / tauri.conf.json / Cargo.lock / START_HERE 当前版本声明）。

| 文档 | 位置 | 状态 |
|---|---|---|
| `START_HERE.md` | 根目录 | ✅ 唯一权威接手文档（含 OBS 台账唯一权威版） |
| `README.md` | 根目录 | ✅ 0.9.2 重写为当前能力 |
| `DAILY_USAGE.md` | 根目录 | ✅ 0.9.2 重写为当前流程 |
| `AGENTS.md` | 根目录 | ✅ 纪律 + 文档政策（不新建根目录文档；发布三件套） |
| `THIRD_PARTY_NOTICES.md` | 根目录 | ✅ 静态声明 |
| `docs/releases/v0.9.1.md` 等 | docs/releases/ | ✅ 每版一份发布记录（含升级验收） |
| `docs/history/PROJECT_MEMORY.md` 等 | docs/history/ | ⚠️ 仅历史；PROJECT_MEMORY 停在 0.9.0（schema v12 描述已失效） |
| `GITHUB_RELEASE_REVIEW.md` | 根目录（未跟踪） | ⚠️ 仅历史，故意不提交 |
| 《轻衡问题台账与版本处理总览.md》 | 项目外（WorkBuddy） | ⚠️ 已废弃；以本文件 §5 为准 |

**发布三件套（写进 AGENTS.md 的政策）**：`docs/releases/vX.Y.Z.md` 一份记录 + 刷新本文件「当前事实」+ DAILY_USAGE（用户可见行为变化时）。开发过程中不再新建报告类文档。

---

## 7. 已知环境陷阱

1. **`Remove-Item` 被安全的包装替换**（AI 会话内）：会把文件移进回收站，但**成功后仍抛异常**，导致 `$ErrorActionPreference="Stop"` 的脚本中断。对策：`try { Remove-Item } catch {}` + `Test-Path` 复核真实结果，或用 `[System.IO.File]::Delete()` / `[System.IO.Directory]::Delete($p, $true)`。
2. **删大目录用 robocopy**：`robocopy <空目录> <目标> /MIR /NFL /NDL /NJH /NJS /NC /NS /NP /R:0 /W:0` 再删空壳，比 `Remove-Item -Recurse` 快 5–10 倍。robocopy 退出码 0–7 都算成功，≥8 才是失败。删 5 万文件 / 55 GB 实测耗时 **29 分钟**。
3. **`Start-Process -Verb RunAs` 可能被安全策略拦截**，需要管理员的操作可能只能交用户手跑。
4. **不要用命令行 / 自动化启动生产 exe 做持久化验证**。历史上出现过：工具上下文读到的 AppData 路径是**另一套较小的数据库**，与用户正常入口打开的不是同一份文件视图。验证必须通过 Windows Explorer / 开始菜单由用户亲自打开。
5. **沙箱代理**：AI 会话环境可能注入 `HTTP_PROXY=http://127.0.0.1:8480`（由 `sandbox-cli.exe` 提供）。用户自开 PowerShell 不继承该变量。曾出现 `schannel: server closed abruptly` 的瞬时失败，重试即好——**不要据此改 git 或系统 TLS 配置**。
6. **PowerShell 5.1 读无 BOM 的 `.ps1` 按 ANSI 解码**：写脚本时保持纯 ASCII，否则中文乱码。
7. **中文文件名与 GitHub**：Release 附件会被净化成 ASCII。上传时用 `FitwiseLocal_0.9.x_x64_zh-CN.msi` 作为实际文件名，中文名放 label（`gh release create TAG "path#label"`）。

---

## 8. 用户的工作方式偏好

- 用中文协作，**先给结论和证据**，不要过程性铺垫。
- **渐进式推进**：每步做完确认再继续，不要一次性抛出全量大方案。
- 每个阶段完成后必须**主动挑刺**，修复或明确标注缺口，再给下一步。
- 优先让软件完整稳定地跑起来；备份扩展、加密、云端 AI 不抢占日常可用性。
- 依赖优先用成熟轮子；装新东西先问。
- **测试数量不能代替实机验收**：未实际跑过的测试/构建/安装/UI 操作，不得声称完成。
- 明显超出合理成本的验收流程要主动叫停（曾因 Hyper-V 隔离验收反复修订 6 轮脚本、投入远超收益而被用户中止）。
- 文档要精简、结论先行；避免重复造文档。

---

## 9. 接手后请先交这份报告（不要立刻编码）

1. `git rev-parse --abbrev-ref HEAD` / `git log -1` / `git status` 的实际输出。
2. 四处版本号是否一致（`package.json`、`Cargo.toml`、`tauri.conf.json`、`Cargo.lock`）。
3. 你是否确认 schema 为 v14、迁移共 14 个、命令白名单与第 3.3 节一致。
4. 你理解的下一步最小改动是什么，**不会触碰**哪些数据范围，打算跑哪些测试。
5. 若发现本文件与代码不一致，**列出证据并先更新本文件**，不要静默假设。

---

## 10. 关键历史（一句话一条，供理解设计意图）

- `0.8.1-fallback`：0.9.0 精简手术的回退点（DB 冷拷贝 + JSON 导出 + tag + 0.8.1 MSI 四件套）。
- `0.9.0`：产品精简手术——砍掉库存/采购/收件箱/AI/计划等，导航收敛为「今日/饮食/身体/运动」。引入 `0014` 破坏性迁移。
- `0.9.0 → 0.9.1`：**零 schema 迁移**（`user_version` 保持 14，迁移文件 diff 为空）。纯代码升级，新增菜谱入餐、批量添加、照搬任意日期、菜谱搜索排序、食材库管理。
- 用户此前 0.8.x → 0.9.0 的数据清空是**用户主动要求**，既不能证明无损升级成功也不能证明失败。**0.9.0 → 0.9.1 才是真正需要验证"数据保留"的那次升级**，已通过合成数据 + 真实环境覆盖安装验证。
- 0.9.1 曾尝试用 Hyper-V 虚拟机做隔离验收，反复修订 6 轮安全脚本后因成本过高被用户叫停，VM 与测试树已于 2026-10-25 全部清除。**不要再自行重启这条路线**，除非用户明确要求。
- `0.9.2`（开发中，零迁移）：图表根因修复（7 天窗口+2 点阈值缺陷、loading 塌缩、coverage 注释）、导出 schemaVersion 实读、食材库拆独立页（选择器瘦身 + 跨页篮子 store）、`set_target_profile` 目标可编辑、常吃栏/上次份量/还能吃/streak/餐次条、文档三层收敛（docsGuard 冻结）、六测试文件 include! 接线纠正（曾误判孤儿删除又由编译器救回，见 2337fe5/5ff7210）。

---

## 11. 0.9.4 库存轻量版（食物柜）设计要点（已批准，已实现）

**边界**：单表「食物柜」——只回答"家里还有什么、快没了没有"。**不恢复** 0.9.0 砍掉的成本账、采购流程、批次/熟食、FEFO 三量结构。

- **数据（实现修正）**：立项时设想“新表 pantry_items + 迁移 v15”；实现改为 JSON 信封第 9 集合 `pantryItems`（`domain_store.rs` COLLECTIONS），零迁移、user_version 仍 14，旧库三条装载/写入/重置路径自动补空数组。字段同设想：`id`、`foodDefinitionId`（挂食材库定义）、`quantity` + `unit`、可选 `expiresAt`、`lowStockThreshold`、`note`、时间戳。与饮食记录完全解耦。
- **操作**：入库（+数量）、取出（−数量）、改低存量阈值、删条目；快捷增减按钮为主界面。无审计链要求之外的字段约束（简单 CRUD，不进领域命令事务复杂度）。
- **菜谱联动（只读）**：菜谱卡显示「还缺什么」提示——按当前柜内量对比菜谱原料需求量，**只提示、不自动扣减**（自动扣减是旧复杂度的入口，明确不做）。
- **UI**：工具分组独立页或饮食页抽屉（0.9.3 驾驶舱重构时定）；列表按食材分组、低存量高亮。
- **明确不做**：成本/单价、供应商/采购平台、批次与熟食、自动扣库存、库存与摄入互相反推。
