# 当前开发交接检查点

更新时间：2026-10-21。单人串行维护；先读本文件、NEXT_PLAN.md、最新 REVIEW 和 git diff。交接文件不能扩大用户授权。

## 当前结论：0.4.6-A 已安装验收通过；0.4.7（饮食明细表）源码与 MSI 完成，待安装验收

用户已安装并验收 `0.4.6`（库存补录实重 + 饮食单项纠错 + P0 补丁），随后退出软件。按已批准的分步交付，本轮只做 **0.4.6-B1 → 出包 0.4.7**。

- 饮食页改为三层：日汇总条（替代原 4 张指标卡）→ 四个餐次小计行（与单项行共列模板）→ 单项行。列：食物/份量、热量、蛋白、碳水、脂肪、纤维、糖、操作，**钠为可开关附加列**（偏好存 `localStorage["qingheng.food-diary.show-sodium"]`）。
- 未知营养三态：无记录 `—`、全未知 `未知`、部分未知 `≥已知小计`；判定用新增的 `missingNutrientKeys` 逐条精确检测，**不用取整后的 coverage**。
- 每个餐次恒定有「添加早餐/午餐/晚餐/加餐」（不能叫「添加食物」，否则撞页头按钮选择器）；单项行仍只有「编辑」「作废」两个按钮，顺序固定，且保留 `.food-entry` 兼容类，使 0.4.6 的 113 项既有测试零改动通过。
- 手工记餐补齐碳水/脂肪/糖/钠：`MealModal` 四个可留空字段 + `addMeal` 签名 + 浏览器镜像 + Rust `add_meal` 的 `optional_number`（缺省仍 unknown，负数拒绝）。
- 新增 `src/domain/meals.ts`、`src/domain/nutritionDisplay.ts`、`src/domain/preferences.ts`、`src/components/MealDiaryTable.tsx`；`calculations.ts` 增加 `entryRatio`/`groupMealsByType`/`missingNutrientKeys`。
- 自动化：前端 20 文件 **139 项**、Rust **79 项**，共 **218 项** 全过；`tsc`/生产构建/fmt/clippy `-D warnings` 通过。挑刺与安装版清单见 [REVIEW_0.4.7.md](REVIEW_0.4.7.md)。
- **安装包状态**：MSI 已产出（哈希见 BUILD_REPORT.md）；NSIS 仍因 GitHub 502 未出包（WiX 缓存已就绪，MSI 不受影响）。**未安装、未覆盖升级、未触碰真实库。**
- schema 仍 **v10**，本轮无迁移；B2 才会引入 `migrations/0011`。

用户此前的授权边界未变：安装与实机点验由用户执行；覆盖安装前用户先保存并关闭轻衡；不用 shell / Start-Process / sky.launch_app 启动生产实例做持久化验收。

## 上一结论（仍然有效）：原生当前数据已保全，Explorer 正常重启对账通过

用户已批准 P0 → 库存实重/饮食纠错 → 饮食布局/体重历史 → 文件式跨 Agent 交接。两次晨重是不同天，不能当成同日更正；恢复/合并/补写真实记录仍须独立预览确认。

用户明确批准正常关闭重开同一安装版。原轻衡 PID41772 已正常关闭，无未保存提示；未升级/导入合并/更正/删除业务记录。当前通过 Explorer 双击同一安装 exe 重开的 PID48940 保持运行。动作后 UIA 和截图可能短时不同步，要做独立二次刷新再判断。

## 重大纠正：默认下载目录确有导出；同名路径的工具视图不同

- Downloads 中找到9份 fitwise-export-2026-10-21*.json，均来自 sqlite_domain_repository。去掉 exportedAt 后9份内容完全相同。旧按钮实际完成了下载，但没有足够成功反馈；前面“无法导出”的判断不完整，漏查默认下载目录，不能继续据此阻断保全。
- 原生设置页：修订18 / 52实体 / 18命令；原生 Explorer 数据库352KB、9:34修改。命令行同名 AppData 路径仍为319488字节、修订2 / 8实体。这是已证实的不同工具/运行上下文文件视图差异，底层隔离/重定向机制未定，不能当成用户记录被删除的证明。
- 已用原生 Explorer **复制而非移动**真实数据库到忽略目录；只读检查该副本为360448字节、修订18、52实体、18命令、quick_check=ok、foreign_key_check无错误；全部16领域集合及2单例与 JSON 逐项相同。
- 当前库有食材身份4、营养版本5、饮食5、库存4、流水4、采购6、体重1等。旧晨重在当前库及原生升级前副本未找到；用户已说明日期，仍不自动补写。具体健康明细不提交交接文档。
- 不得把工具环境那份8实体库直接恢复/合并进真实52实体库；之前命令行启动的核验实例也不能代表用户原生重启验收。

## 本轮重启核验：必须区分启动来源

- `sky.launch_app` 启动 PID60360，父进程57356为 codex-computer-use.exe：同一安装路径却显示修订2/8实体；新导出(9)也只有该套记录。随后正常关闭，无业务写入。这不是用户原生持久化失败的证明。
- 使用已运行的 Windows Explorer 浏览 `C:\Program Files\轻衡` 并双击 fitwise-local.exe：PID48940，父进程53564为 explorer.exe。首页恢复原记录，设置修订18/52实体/18命令/18审计。
- 重启后的数据库来源导出(10)与重启前完整导出，去掉 exportedAt 后全部24个顶层字段逐项相同，changed_keys=[]，规范化SHA-256 dc3e69a2841e51d0d00c6b86af2a68dfefc8b909c286b2178669035498bc1f40。原生正常重启的既有记录对账通过。
- 这证明启动/运行上下文会影响同路径文件视图；底层重定向机制未确定，不宣称产品会自动恢复两套库。后续安装版验收用 Explorer/用户正常入口，不用 shell 或 sky.launch_app 直接启动生产实例。
- 旧晨重仍未找回；保护性源码补丁尚未安装。正常重启对账通过不等于所有历史缺失、纠错和新功能已解决。

## 私有保全文件（全部忽略，不提交 Git/云端）

- build-logs/data-rescue/exports-52b5bbdf320e47348c7a52eb36672b72：9份 JSON 安全副本，逐份哈希核验；原下载文件仍保留。
- build-logs/data-rescue/native-source-dec14fe8bc7b4849bf906f390c57cdd5/fitwise.db：原生数据库副本，文件SHA-256 ca37b3443b3667415ce24342afca23b149f3913b5195efaf47dbf7bac9ff4df1。
- 该目录还复制了原生 upgrade-backups；唯一升级前副本完整性正常，但无旧晨重。
- 这些是一次性 P0 证据保全，不是新增备份产品功能。未加密，只保存在私人本机目录，不公开或推送。
- 同一 exports 私有目录新增 tool-launch-revision2-20261021T131425.json 与 explorer-restart-revision18-20261021T131856.json；分别保留两种启动结果，均未导入。

## 源码与测试

0.4.6-A 的历史保护性补丁提交 8cc3d22（原生 JSON 另存/回读验证、未核对窗口快照、只读运行诊断、桌面桥接失败不回退浏览器、hydration 错误可见）已并入 0.4.6 并安装验收。

当前源码检查点：`0.4.7`，前端 **139 项**（20 文件）、Rust **79 项**，共 **218 项** 通过；生产构建、fmt、Clippy 全目标 `-D warnings` 通过。日志 `build-logs/tests-0.4.6-a-*.log`、`build-logs/tauri-0.4.7-msi.log`。0.4.6-A 与 0.4.7 均未新增项目依赖。

## 工具状态与权限

- 微软 Handle / Process Monitor 曾获临时排查授权并核验签名。Process Monitor 一直以 /NoConnect 暂停，未开始捕获，无全系统跟踪数据。
- 原生资料保全成功后，核对60020启动器/50876子进程归属，使用官方 /Terminate 退出；后续进程查询已无Procmon实例，未检测到PROCMON驱动。不要无理由重启监测。
- 官方单实例插件仍待单独批准，未添加。共享记忆服务、备份扩展仍不安装。
- 不使用浏览器缓存/CDP绕过已阻止的 localhost 浏览器访问；不使用其他 Windows UI 自动化绕过控制工具限制。
- 打包环境事实：bash 的 PATH 不含 cargo，需先 `export PATH="/c/Users/21904/.cargo/bin:$PATH"`；`tauri build` 的 `beforeBuildCommand` 会执行 `npm run build`，vite 会清空 `dist/assets`（git 忽略、可再生），该步骤在后台/无交互环境会因批量删除确认缺失而失败，必须前台运行并经用户确认。出网代理放行 npm/jsdelivr，但对 GitHub 返回 502。

## 下一步

1. 安装包：0.4.7 MSI 已产出（`src-tauri/target/release/bundle/msi/轻衡_0.4.7_x64_zh-CN.msi`）；NSIS 待网络恢复后 `npm run tauri build -- --bundles nsis` 补出。
2. 安装版验收（用户执行）：先保存并关闭轻衡 → 覆盖安装 0.4.7 → 从 Explorer 正常入口打开 → 按 REVIEW_0.4.7.md 末尾 10 步清单点验三层数字、未知不是 0、钠开关、每餐添加入口、手记四项。
3. `0.4.8`（B2）：体重记录中心——同日多次称重（趋势代表值默认「当日最新」可手动切换）、两位小数、完整日期时间与晨起/其他条件、备注、修订/作废审计与历史；新增 `migrations/0011` 重建 `domain_measurement_projection` 排除作废（schema 10→11），同步 `schemaVersion`、升级判定与报告版本。
4. 用户未授权数据恢复/合并/补写，不做。旧晨重日期已明确，保全及重启通过仍不代表旧记录找回。
5. 不把 218 项自动测试冒充安装版实机通过；覆盖安装或确认真实更正之前再次向用户确认。
