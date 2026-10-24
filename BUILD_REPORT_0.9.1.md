# 轻衡 0.9.1｜候选版本交付报告（待批准版）

分支：`dev/0.9.1`（基线 `900fd9d` = 0.9.0，未推送）
提交序列：`6b13ae2` P0+P1 → `14b8b0b` P2 → `a30797d` P3 → `d547206` P4 → `cc0a652` P5 → `ba8c2dd` P6 → `fbb9624` P7 → `3e577e8` 版本号+升级兼容测试
本报告完成即停在候选验收阶段：未推送、未打 tag、未发 Release、未触碰真实数据库与正式安装环境。

---

## 1. 功能实现清单及对应文件

| 阶段 | 功能 | 主要文件 |
|---|---|---|
| P0 | SQL 对象清单与 user_version=14 冻结守卫 | `src-tauri/src/migration_scenario_tests.rs` |
| P1 | OBS-009 菜谱营养值统一格式化（未知不显 0）；OBS-011 纠错文案中文单位 + 历史英文单位显示层归一化 | `src/domain/nutritionDisplay.ts`、`src/domain/foodLibrary.ts`、`src/components/RecipeManagerDrawer.tsx`、`src/pages/FoodPage.tsx`、`src/components/MealDiaryTable.tsx`、`src/components/MealCorrectionModal.tsx`、`src-tauri/src/food_library.rs`、`src-tauri/src/meal_corrections.rs` |
| P2 | R2 待确认篮子批次合计（复用日记口径）+ 行内改量（step=any 小数） | `src/components/FoodLibraryModal.tsx`、`src/styles.css` |
| P3 | R1 后端 `record_recipe_meal`：条目须属菜谱版本、逐项 historical_portion 钉住版本、允许追加非空餐次、审计+完成日重开、recipeVersionId 溯源 | `src-tauri/src/recipe_meal_commands.rs`(新)、`src-tauri/src/recipe_meal_command_tests.rs`(新)、`src-tauri/src/domain_commands.rs`、`src-tauri/src/lib.rs`、`src-tauri/src/food_library.rs`、`src/data/domainCommands.ts`、`src/domain/types.ts`、`src/store/appStore.ts` |
| P4 | R1 草稿 UI：×0.5/×1/×2/自定义（×1 明示"完整配方量≠一人份"）、逐项微调/去掉、实时合计预览、确认入餐；入口=饮食页菜谱卡+管理抽屉 | `src/components/RecipeMealDraftModal.tsx`(新)、`src/pages/FoodPage.tsx`、`src/components/RecipeManagerDrawer.tsx`、`src/styles.css` |
| P5 | R3 照搬支持任意历史来源日期（下拉列出所有有记录的天）；修复预览分支对显式来源日期的错误拒绝 | `src/components/CopyMealModal.tsx`、`src/domain/meals.ts`、`src/store/appStore.ts`、`src-tauri/src/meal_copy_tests.rs` |
| P6 | R4-A 菜谱管理抽屉名称搜索 + 名称/创建时间排序 | `src/components/RecipeManagerDrawer.tsx`、`src/styles.css` |
| P7 | OBS-006 归档/取消归档、未引用食材永久删除（同事务全量引用扫描+级联+审计留全量内容）、未引用名称/品牌纠错（生熟状态拒绝并引导新建+归档）；饮食页「食材库管理」直达入口；命令队列异常处理指引 | `src-tauri/src/food_library.rs`、`src-tauri/src/food_management_command_tests.rs`(新)、`src-tauri/src/domain_commands.rs`、`src/domain/types.ts`、`src/data/domainCommands.ts`、`src/data/foodLibrary.ts`、`src/domain/foodLibrary.ts`、`src/store/appStore.ts`、`src/components/FoodLibraryModal.tsx`、`src/components/RecipeEditor.tsx`、`src/pages/FoodPage.tsx`、`src/components/RecipeMealDraftModal.tsx`、`src/styles.css` |
| 收尾 | 版本号三处+lockfile 升 0.9.1；0.9.0 形态合成数据升级兼容测试 | `package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.lock`、`src-tauri/src/upgrade_compat_command_tests.rs`(新) |

新命令 4 个（`record_recipe_meal`/`set_food_archived`/`delete_food`/`correct_food_identity`）均遵守同提交纪律：白名单 + Rust 分发 + 前端 DomainCommandKind + 类型定义同一提交改动。

## 2. 自动化测试与回归测试结果

| 套件 | 基线(0.9.0) | 本版 | 结果 |
|---|---|---|---|
| cargo test | 86 | **102 通过 / 0 失败** | ✅ |
| vitest | 246 | **269 通过 / 0 失败**（34 文件） | ✅ |
| tsc -b | — | 0 错误 | ✅ |
| release 构建 | — | MSI + NSIS 成功（3m47s） | ✅ |

新增测试 16（Rust）+ 23（前端），覆盖：缩放换算、AC1 同口径、非空追加、旧版本钉住、拒绝无痕、回放幂等、主动重复合法、未知不归零、归档三入口过滤、删除五类引用拒绝、纠错边界、生熟状态守卫、遗留数据默认未归档、0.9.0→0.9.1 信封字节级不变等。

## 3. 未通过测试或尚未验证的风险

- 无未通过测试。
- **尚未验证（需后续授权/环境）**：① MSI 实机安装与交互（须用户执行，见第 6 节清单）；② 0.9.1 数据被 0.9.0 读取的反向兼容实测（代码级结论：Definition 无 deny_unknown_fields、命令走原始 Value 变更保留字段、bootstrapState 不覆盖已有信封；正向兼容已由合成测试证明）；③ 真实库受控副本对账；④ 命令队列跨重启硬化未实施——剩余窄窗口风险（后端已落库与响应送达之间终止应用且用户重记）已用 UI 指引缓解；⑤ consumedRatio 录入界面本版未新增比例输入（R5 经菜谱缩放落地，consumedRatio 仍由更正链路使用）。
- **升级历史事实与验收依据（2026-10-24 用户纠正，详见 `RESET_ACCEPTANCE_0.9.0.md` 第 9 节）**：0.8.x 之前多次升级数据均自动保留；**0.8.x → 0.9.0 的数据清空是用户主动要求，非升级事故，既不能证明无损升级成功也不能证明失败**；**0.9.0 → 0.9.1 才是需要重点验证真实数据保留能力的升级，目前只有合成数据证据，无真实升级证据**。既往升级印象不得补位为本版验收依据。

## 4. 合成数据升级兼容性验证结果

`upgrade_compat_command_tests.rs`（2 个测试，全部通过）：
- `legacy_database_opens_under_0_9_1_without_any_migration_or_data_change`：0.9.0 形态信封（v14、食材无 archived 键）在 0.9.1 代码下首启，`ensure_repository_schema` 为 no-op，**信封字节级不变**。
- `new_commands_work_on_legacy_data_and_old_records_stay_untouched`：旧菜谱经新命令入餐（800 kcal，快照口径）；归档旧食材后日常挑选隐藏而历史餐食/快照不变；被引用旧食材删除被拒；无引用旧食材（含已归档）删除成功且级联版本；餐食/菜谱/体重/完成日/档案一条不少。
- 另有守卫测试冻结 SQL 对象清单（7 表 / 4 视图 / 2 索引）与 user_version=14，确保零迁移承诺不会被悄悄破坏。

## 5. 候选 MSI 路径、版本号与 SHA-256

| 产物 | 路径（仓库内） | 大小 | SHA-256 |
|---|---|---|---|
| MSI（主验收件） | `src-tauri/target/release/bundle/msi/轻衡_0.9.1_x64_zh-CN.msi` | 6.79 MiB | `cdebbe1796908a0d1bad67e178c150e14059aa99d2016a308fee62a7b008b1bd` |
| NSIS（备选） | `src-tauri/target/release/bundle/nsis/轻衡_0.9.1_x64-setup.exe` | 6.20 MiB | `657688a699f75ca5f115b36696dd8617e7e067dcec5522a34ca8fe961f0edf7a` |

版本号：package.json / Cargo.toml / tauri.conf.json / Cargo.lock 均为 0.9.1。产物名称为构建工具默认输出（轻衡_0.9.1_x64_zh-CN.msi），未为改名改动构建机制。

## 6. 安装版实际交互验收结果（待用户执行）

尚未执行——须由你在隔离/受控环境双击安装。建议清单：
1. 安装前：保存并关闭轻衡 → 应用内导出 JSON → 整目录拷贝 `%APPDATA%\cn.fitwise.local` → 记录 SHA-256；
2. 双击 MSI 覆盖安装，首启检查今日页/饮食页/身体页正常；
3. 对账：食材/菜谱/餐食/体重/运动条数与导出一致；连续 7 日营养合计与导出一致；
4. R1：菜谱卡「加入餐次」→ ×0.5 → 预览数值变化 → 确认 → 日记出现两条（含原有）；核对"×1 = 完整配方量"文案；
5. R2：批量添加 2+ 食材 → 合计行 → 行内改量（试 194.7 小数）→ 确认；
6. R3：照搬 → 切换更早来源日期 → 确认；
7. R4-A：管理菜谱抽屉搜索/排序；
8. OBS-009/011：菜谱卡数值格式、历史纠错记录显示中文单位；
9. OBS-006：食材库管理 → 归档（日常挑选消失）→ 已归档页恢复；无引用食材删除（二次确认）；被引用食材删除被拒；名称纠错成功；生熟状态更改被拒并出现引导文案；
10. 异常：强制结束后重开，按指引先核对再重记。

## 7. 真实数据升级前仍需完成的验证及独立授权事项

1. 上述第 6 节清单在隔离环境通过；
2. 受控副本（拷贝真实库）对账——**需单独授权**（范围/风险另行说明）；
3. 备份与还原实测一次 —— **需单独授权**；
4. 正式环境升级 —— **需单独授权**。**验收依据更正（2026-10-24）**：本次 0.9.0 → 0.9.1 是真正需要验证「真实数据保留」的升级（既往 0.8.x → 0.9.0 清空为用户主动要求，不构成本次证据；详见 `RESET_ACCEPTANCE_0.9.0.md` 第 9 节）；升级前必须按第 6 节第 1 条完成 JSON 导出 + 整目录冷备份；
5. 降级路径评估（重装 0.9.0 MSI + 重新导出）—— 0.9.1 期间新增记录在 0.9.0 中的可读性未实测，降级前必须重新备份。

## 8. GitHub 正式发布前检查清单（尚未授权）

- [ ] 候选验收通过且本报告经你批准；
- [ ] `dev/0.9.1` 合并/推送至 `qitian-dasheng/fitwise-local`（main）；
- [ ] tag `v0.9.1`（annotated）；
- [ ] GitHub Release `v0.9.1`：附件 = **本报告第 5 节同一 MSI**（哈希一致）+ SHA-256；
- [ ] Release 说明记录：commit、测试结果（102/269）、安装版验收结果、安装步骤、已知限制、降级风险；
- [ ] 0.9.0 的 tag/Release/MSI/Git 历史原样保留；
- [ ] 以上每一步均在你单独授权后执行。

---

**边界声明**：本轮全程未读取、复制或修改真实数据库；未操作正式安装环境；未执行任何 Git 推送/tag/Release；未跟踪文件 `GITHUB_RELEASE_REVIEW.md` 未纳入任何提交。
