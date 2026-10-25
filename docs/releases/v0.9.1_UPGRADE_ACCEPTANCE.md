# 轻衡 0.9.1｜正式升级前最小验收（2026-10-24）

> 结论先行：**可以进入正式升级**。0.9.1 相对 0.9.0 没有数据库结构变更、没有领域迁移逻辑变更，
> 风险集中在「你怎么备份」和「升级后你看一眼数据」这两件人为动作上。

## 1. 是否可进入正式升级：**可以**

| 依据 | 事实 |
|---|---|
| 数据库迁移 | `src-tauri/migrations/` 在 `v0.9.0..HEAD` 之间 **diff 为空**（14 个迁移文件一个都没变） |
| 领域升级逻辑 | `domain_upgrade.rs` **不在** 0.9.1 的改动清单里 |
| 结构冻结有测试兜底 | `migration_scenario_tests::schema_inventory_stays_frozen_for_0_9_1` 通过 |
| 0.9.1 实际改了什么 | `recipe_meal_commands.rs`、`meal_corrections.rs` 等**新增命令**、前端新组件、样式；`tauri.conf.json` 只改版本号 |
| 安装方式 | MSI `UpgradeCode=9bf60242-0b26-5309-9b63-452e0897f267`（两版相同）+ `MajorUpgrade afterInstallInitialize` + `REINSTALLMODE=amus` + `INSTALLDIR` 从 `HKCU\Software\fitwise\轻衡` 继承 → **原地覆盖升级** |
| 安装器是否碰数据 | 生成的 WiX 源里**没有** RemoveFile / 任何指向 AppData 的动作 → 数据目录不受安装影响 |
| 版本一致性 | package.json / Cargo.toml / Cargo.lock / tauri.conf.json **均为 0.9.1**；identifier 仍为 `cn.fitwise.local`（数据目录不变） |

## 2. 实际通过的测试

| 测试 | 结果 | 关键断言 |
|---|---|---|
| `cargo test`（整套） | **102 passed / 0 failed** | 见下 |
| ├ `upgrade_compat_command_tests` | 通过 | `user_version` 必须仍为 14（零迁移）；领域信封 **字节级不变**；旧餐条目 `calories=200.0`、`foodDefinitionId` 不变；被引用食材的删除被**拒绝** |
| ├ `migration_scenario_tests`（3 场景） | 通过 | 全新库只有核心 schema；0.8.1 旧库升级保留核心、只丢废弃表；升级后重启仍稳定且数据完好 |
| ├ `domain_upgrade`（2 项） | 通过 | 升级前快照只建一次且通过 `integrity_check`；迁移失败时回滚 schema 并保留已验证备份 |
| └ `schema_v5_upgrade_*` / `schema_8_upgrade_*` | 通过 | 旧版本升级只新增空库/字段，全部实体保留 |
| `vitest`（前端） | **34 files / 269 tests passed** | — |
| **独立 DB 验证**（Python sqlite3，隔离临时目录，结束后删除） | 全部通过 | ① 0.9.0 库（`user_version=14`）经 0.9.1 启动逻辑：**内容摘要完全一致**、行数一致、`integrity_check=ok`、`user_version` 不变（**零迁移**）；② pre-0.9.0 库跑 0014：删 20 张废弃表、保留 `meals` 与 `settings`、`integrity_check=ok`；③ 文件级备份 → 备份 `integrity_check=ok` 且摘要一致；恢复后 `integrity_check=ok`、摘要一致、`meals=3` |
| 候选 MSI | 7,114,752 B，SHA-256 `CDEBBE1796908A0D1BAD67E178C150E14059AA99D2016A308FEE62A7B008B1BD` | 与既有候选记录一致 |
| 本机环境 | 已装 `轻衡 0.9.0` @ `C:\Program Files\轻衡\`；WebView2 `155.0.4283.62` 已存在 | 升级**不需要联网** |

## 3. 尚存的真实风险（只列会影响数据安全的）

1. **界面未做端到端点验**：没有虚拟机，且数据目录由 `SHGetKnownFolderPath` 决定、无法用环境变量重定向到合成数据，所以「升级后旧记录在界面上可见」这一步只能由你亲自看一眼（下面第 4 步）。DB 层与命令层已验证，但这不是同一件事。
2. **备份必须在应用完全退出后做**：0.9.0/0.9.1 使用 WAL，运行中拷贝可能拿到不一致快照。若 `fitwise.db-wal` 非空而你没一起拷，恢复结果可能少最后几条记录。
3. **迁移 0014 是破坏性迁移**（删 20 张废弃表、删 `inventory/plans/batches` 等领域集合、删 `aiSettings` 单例）。它**已在 0.9.0 执行过**，本次升级不会触发；但若将来从 0.8.x 直接升到 0.9.1，这些废弃数据会被丢。
4. **MSI 是 perMachine**：升级需管理员；MajorUpgrade 会先卸旧再装新，数据在 AppData 不受影响，但**升级过程中不要强制结束安装程序**。
5. WebView2 缺失时安装器会联网下载（本机已存在，不受影响）。

## 4. 最小备份方案（正式升级前）

| 项 | 内容 |
|---|---|
| 备份什么 | `%APPDATA%\cn.fitwise.local\` **整个目录**（含 `fitwise.db`、可能存在的 `fitwise.db-wal` / `-shm`、以及 `upgrade-backups\`） |
| 备到哪 | `D:\FitwiseBackup\2026-10-24-pre0.9.1\`（自定，只要不是系统盘临时目录） |
| 怎么备 | ① 完全退出轻衡（任务管理器确认无 `轻衡.exe`）→ ② 资源管理器复制整个目录 → ③ 记录 `fitwise.db` 字节数与 SHA-256 |
| 怎么验 | 只读打开备份：`sqlite3 备份\fitwise.db "PRAGMA integrity_check;"` 期望 `ok`；或对比字节数 |
| 怎么恢复 | ① 退出轻衡 → ② 把备份目录内容复制回 `%APPDATA%\cn.fitwise.local\`（覆盖）→ ③ 启动 |
| 保留多久 | 升级后至少 7 天，确认数据正常再删 |

## 5. 你需要亲自执行的最少步骤（约 5 分钟）

1. **退出轻衡**，任务管理器里确认没有 `轻衡.exe` 残留进程。
2. **备份**：复制 `%APPDATA%\cn.fitwise.local` 整个目录到 `D:\FitwiseBackup\...`，确认 `fitwise.db` 字节数与源一致。
3. **安装**：双击 `轻衡_0.9.1_x64_zh-CN.msi` → 允许管理员 → 完成（会覆盖 0.9.0，不需要先手动卸载）。
4. **自检**（30 秒）：打开轻衡 → 看最近几天的饮食记录条数与内容、食材库、体重/运动、设置项是否都在；重点确认**最近一条记录**存在（WAL 未丢）。
5. **异常处理**：退出轻衡 → 用第 2 步的备份覆盖回 `%APPDATA%\cn.fitwise.local\` → 如需回到 0.9.0，重装 `轻衡_0.9.0_x64_zh-CN.msi`。

> 若第 4 步发现任何记录缺失或错乱：**不要继续使用、不要新增记录**，直接按第 5 步恢复，并把现象告诉我。
