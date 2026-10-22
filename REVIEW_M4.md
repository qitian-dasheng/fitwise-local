# M4 执行记录（0.8.0 → 0.8.1：三条归档修复项 + 草稿契约简化）

> **状态：已验收通过（2026-10-22，用户安装 0.8.1 点验 3/3：骨架/营养版草稿均导入成功、「食物状态」标签正确、侧栏唯一设置入口）。M0–M4 路线图主线至此全部验收通过，下一阶段由用户规划。**
> 范围决策（2026-10-22，用户确认）：**深色主题取消**（当前无需求；若重启建议与 M2.5 组件拆分合并评估），
> M4 仅含三条 0.7.0 验收归档项。计划调整由用户亲自确认。

## 0.8.1 点验修复轮（2026-10-22 晚，用户点验 0.8.0 后）

用户点验结果：①AI 草稿导入报 `invalid type: integer 40, expected a string`（**bug**）；②③通过；并反馈
**「AI 菜单草稿十分臃肿，没必要有」**。用户选择方向 A（简化），据此做契约瘦身：

1. **nrv 类型契约修复**：Rust `MenuItem.nrv` 由字符串表改为**数字表**（`BTreeMap<String, f64>`），
   与前端轻校验、格式示例同口径——0.7.0 起示例用数字、Rust 只收字符串，`{"protein": 40}` 这类
   合法输入被「expected a string」拒收。
2. **逐菜营养表改为可选**：items 每条只需 `name`；提供 nutrients（非空）才要求
   basisQuantity/basisUnit 并跑三项校验，否则记「无营养数据，未校验」直接放行。前端 `checkItem`
   与 Rust `validate_item` 同口径收紧/放宽。
3. **格式示例瘦身**：菜单骨架约 15 行（items 只需 name），纯 JSON 不带注释（示例本身必须可解析）；
   授权摘要声明「营养表可选 + basisUnit 五值硬性约束」两行。
4. 外部 AI 输出体积从上百行降到约 15 行；「AI 只能建草稿、确认才生效」边界不变。

验证：`tsc -b` ✅；vitest **37 文件 / 318 项**（+4 契约简化用例）✅；`cargo fmt/clippy/test` **151 项**（+3）✅。
插曲：安全中心拦截一次测试构建产物写入（DLL 导出表，经用户同意后清理残缺产物重跑，通过）。

## 0.8.0 轮（三条归档项）

| # | 任务 | 交付 |
| --- | --- | --- |
| 1 | AI 草稿中文单位自动映射 | `menuDrafts.ts` `checkItem` 前置归一化：trim（含全角空格）→ 大小写宽容 → `UNIT_ALIASES` 映射（克/毫升/个/份/餐/碗/包/袋/盒/瓶/罐/箱等 → 五合法值）并**回写 basisUnit**（防「前端过、Rust 拒」假修复）；「100g」等数字粘连不剥离，报错点名「数字写 basisQuantity、单位单独写 basisUnit」；失败文案保留 `basisUnit` 字样并指向「查看草稿格式」。Rust 白名单不动（防御纵深）。授权摘要补硬性约束说明（basisUnit 五值）。 |
| 2 | 界面用词统一「食物状态」 | `FoodLibraryModal.tsx` FoodEditor 表单「计量状态」→「食物状态」，与收件箱草稿表单对齐（measurementBasis 表单标签全仓仅此两处，已核实）；tests 零命中，无需改断言。 |
| 3 | 侧栏重复「设置」入口修复 | `App.tsx` 删 `sidebar-bottom` 旧设置按钮（M1.5 前残留；工具组入口保留）+ 删 lucide `Settings` import；`styles.css` L139-142/L150 联合选择器移除 `.sidebar-bottom > button` 分支；`theme.css` 删对应死规则。 |

## 验证

| 门槛 | 结果 |
| --- | --- |
| `npx tsc -b` | ✅ 通过 |
| `npx vitest run` | ✅ **37 文件 / 314 项**（0.7.0 基线 310 + 本轮 +4：中文单位映射 4 组用例） |
| `cargo test` | ✅ **148 项**（Rust 零改动，确认不变）；`cargo fmt --check` / `clippy -D warnings` 通过 |
| `tests/designGuard.test.ts` | ✅ 4 项（theme.css 只删不加，不触白名单） |

## 版本

- package.json / tauri.conf.json / Cargo.toml：0.7.0 → 0.8.0（M4 归档项）→ **0.8.1**（点验修复轮：契约简化 + nrv 类型）。
- MSI：`src-tauri/target/release/bundle/msi/轻衡_0.8.1_x64_zh-CN.msi`，**8,458,240 B（8.07 MiB）**，SHA-256 `57D970F270D633DB407DFA804F1BBE0CF2206BAABC180178E1F34778CDA96FCD`；0.8.0 包已被 0.8.1 取代，勿安装。
- 提交：代码 `fb9056d`（0.8.0 三项）、`119b8d2` + `453e876`（0.8.1 Rust/前端契约，Rust 侧曾漏 add 已补交）、`670e730`（Cargo.lock）；文档 `d994eb8` / `2f0ce45` / 本次回填（commit 号以 git log 为准）。

## 学习记录

- 初始化 `.learnings/`（self-improving 技能），首条 [LRN-20261022-001]：点验/文档步骤必须引用界面原文标签，不能用内部术语（0.7.0 点验「计量状态 vs 食物状态」往返的直接教训）。
- **[新] 跨端契约（TS↔Rust serde）必须以同一份示例 JSON 对拍**：0.7.0 给 AI 的格式示例用数字 nrv、Rust 结构体却定义字符串表，前端轻校验放行、Rust 拒收——前端过了≠通道通。教训：改契约先改格式示例并跑「示例→Rust parse」的对拍测试（本轮已加：slim_contract_tests::integer_nrv_values_are_accepted_matching_the_frontend_contract）。

## 安装版点验清单（用户执行）

1. **计划页 → AI 菜单草稿**：把授权摘要发给外部 AI（现在的摘要是瘦身版），拿回草稿粘贴导入。两种都应成功：①只有菜目名的骨架草稿（显示「无营养数据，未校验」）；②`nrv` 写**整数**的营养版草稿（不再报「expected a string」）。`basisUnit` 写「kg」「100g」仍应被拦。
2. **饮食页 → 添加食物 → 新建食物**：表单字段显示「**食物状态**」。
3. **侧栏**：只有工具组一个「设置」；底部只剩用户资料卡；折叠态正常。
