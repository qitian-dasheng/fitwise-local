# 0.9.1 免安装独立数据功能验收可行性报告（路线 D · 只读分析）

日期：2026-10-24（Asia/Shanghai）
分支：`dev/0.9.1`（HEAD `3c30a35`）
性质：**只读可行性分析**。本轮未启动 0.9.1 可执行程序、未安装任何 MSI、未修改 Sandbox/驱动/系统组件/组策略、未读取/复制/哈希/迁移真实数据库、未修改源码、未重新构建、未推送 GitHub/未创建 tag 或 Release。真实库与正式安装环境仅查验**元数据**（存在性/大小/时间戳），未读库内容、未计算真实库哈希。

---

## 1. 结论摘要（TL;DR）

| 问题 | 结论 |
|---|---|
| 免安装运行 0.9.1 本身可行吗？ | **可行**。release exe 自包含（前端资源构建期内嵌），不依赖安装目录；宿主已装 WebView2 Evergreen Runtime。 |
| 「修改 APPDATA 环境变量实现独立数据目录」可行吗？ | **不可行**。代码级证据：数据目录经 `SHGetKnownFolderPath`（KnownFolder API）解析，**不读 `%APPDATA%` 环境变量**；WebView2 目录同理。 |
| 同用户直接运行候选 exe 安全吗？ | **不安全**。0.9.1 与正式版 0.9.0 使用同一编译期标识符 `cn.fitwise.local`，数据库与 WebView2 数据目录**逐字节同路径**；0.9.1 一启动就会打开真实库，后续任何录入都会写进真实数据。 |
| 有可用的隔离路径吗？ | **有，但需换路线**：① 完整虚拟机（推荐，可同时覆盖 MSI 安装验收）；② 第二个本地 Windows 用户账户；③ 改 `tauri.conf.json` 目录覆盖并重新构建（产物与候选 MSI 不对应，仅作非候选冒烟备选）。Windows Sandbox 路线已在前序诊断中判定失败、停止。 |
| 下一阶段需要什么？ | 至少一项单独授权：虚拟机验收 / 第二用户验收 / 非候选构建冒烟（见第 10 节清单）。 |

---

## 2. 审计方法与证据边界

- **代码证据**：直接读取 vendored 依赖源码（Cargo registry）与应用源码，追踪从命令入口到文件系统路径的完整调用链，不停留在「改了 APPDATA 应该有效」的猜测。
- **产物证据**：只读查询 MSI File 表（msi.dll 只读打开，非安装操作）、文件版本信息、SHA-256（仅构建产物，不含真实库）。
- **环境证据**：`%APPDATA%`/`%LOCALAPPDATA%` 相关目录只查元数据；正式安装目录只查文件列表/大小/时间戳。
- **未做的事**：未运行 exe、未安装、未启动生产 0.9.0、未读库内容、未动 Git 历史（本报告为新增文件）。
- **事实与推测分离**：第 3 节「已验证事实」均有文件/命令出处；「推测」单独标注。

---

## 3. 八个调查点逐项结论

### 3.1 0.9.1 可执行程序存在性、版本与构建产物对应性 —— ✅ 已核实

| 项 | 值 | 证据 |
|---|---|---|
| 候选 exe | `src-tauri/target/release/fitwise-local.exe`，9,380,352 字节，mtime 2026-10-24 14:31 | `ls -la` |
| 候选 exe 版本 | ProductVersion/FileVersion 均 **0.9.1**；ProductName 轻衡；CompanyName fitwise | 文件版本信息（只读） |
| 候选 MSI | `src-tauri/target/release/bundle/msi/轻衡_0.9.1_x64_zh-CN.msi`，7,114,752 字节，SHA-256 `cdebbe17…b1bd` | `sha256sum`；与 `BUILD_REPORT_0.9.1.md` 第 5 节记录一致 |
| **MSI↔exe 对应** | MSI File 表（只读 SQL）：FileName `kdt3_cpw.exe\|fitwise-local.exe`，**FileSize 9,380,352**，**Version 0.9.1.0** → 与候选 exe 字节数、版本完全一致 | msi.dll 只读查询 File 表 |
| NSIS 备选 | `bundle/nsis/轻衡_0.9.1_x64-setup.exe`，6,501,152 字节，SHA-256 `657688a6…` | 与交付报告一致 |
| 版本号一致性 | package.json / Cargo.toml / tauri.conf.json / Cargo.lock 均为 0.9.1；exe VersionInfo=0.9.1 证明构建时工作树已含 0.9.1 版本号（先构建 14:31、后提交 14:32:45，时序正常） | git 记录 + 版本信息 |
| 正式版 0.9.0 对照 | `C:\Program Files\轻衡\fitwise-local.exe`，9,333,760 字节，版本 0.9.0；0.9.0 MSI File 表 FileSize 9,333,760 / Version 0.9.0.0 —— 生产安装件与候选件可明确区分 | 版本信息 + MSI File 表 |

**结论：候选 exe 与候选 MSI 对应关系成立（字节数+版本双匹配）；候选件与正式安装件版本可区分。**

### 3.2 Tauri Windows 数据目录解析机制与环境变量隔离可行性 —— ❌ 环境变量隔离不成立（核心结论）

完整调用链（代码级证据，全部已读）：

```
domain_store.rs: database_path()
  → app.path().app_data_dir()?.join("fitwise.db")
    → tauri-2.12.4/src/path/desktop.rs:251 app_data_dir()
      → dirs::data_dir()?.join(<identifier>)
        → dirs-7.0.0/src/win.rs:10 data_dir()
          → dirs_sys::known_folder_roaming_app_data()
            → dirs-sys-0.5.0/src/lib.rs:177 known_folder(FOLDERID_RoamingAppData)
              → dirs-sys-0.5.0/src/lib.rs:150 SHGetKnownFolderPath(...)   ← 运行时调 KnownFolder API
```

- **已验证事实**：目录解析终点是 `SHGetKnownFolderPath`，**不是 `std::env::var("APPDATA")`**。改子进程环境变量中的 `APPDATA` **不会**改变该 API 返回值（KnownFolder 按用户配置文件/注册表解析，环境变量只是登录时的一份拷贝）。「独立环境变量隔离」方案**不成立**。
- WebView2 数据目录同理：`tauri-2.12.4/src/manager/webview.rs:563`（Windows 强制）：
  ```rust
  if pending.webview_attributes.data_directory.is_none() {
      match manager.path().app_local_data_dir() { ... }   // %LOCALAPPDATA%\cn.fitwise.local
  }
  ```
  WebView2 再拼 `EBWebView` → 实测目录 `%LOCALAPPDATA%\cn.fitwise.local\EBWebView` 存在（mtime 2026-10-24 16:10，与生产使用时间吻合）。该路径经 `SHGetKnownFolderPath(FOLDERID_LocalAppData)`，环境变量同样无效。
- **唯一官方支持的目录覆盖**：`tauri.conf.json` 的 `app.appDirectoriesOverride`（当前配置文件中**无**此项）→ 需修改源码并重新构建，产物即与候选 MSI 不对应；本轮禁止重新构建。
- **同路径确认**：0.9.1 与 0.9.0 的标识符均为 `cn.fitwise.local`（`git show v0.9.0:src-tauri/tauri.conf.json` 与 HEAD 一致，HEAD 相对 v0.9.0 的 conf 差异仅 version 一行）。**同用户下，0.9.1 与正式版 0.9.0 的数据库目录和 WebView2 目录逐字节相同。**

### 3.3 除 fitwise.db 外的持久化文件/缓存/日志/配置 —— ✅ 已穷尽（生产代码）

| 位置 | 内容 | 触发条件 | 证据 |
|---|---|---|---|
| `%APPDATA%\cn.fitwise.local\fitwise.db` | 主库 | 每次启动 | `domain_store.rs:36-40` |
| `%APPDATA%\cn.fitwise.local\fitwise.db-wal` / `-shm` | SQLite WAL 边车 | WAL 模式运行期 | 目录实测存在过同名文件 |
| `%APPDATA%\cn.fitwise.local\upgrade-backups\before-schema-12-*.db` | 升级前备份 | **仅当**打开的库含旧 schema 且未记录 version=12 升级报告 | `domain_upgrade.rs:96-120`；v14 已迁移库不会触发 |
| `%LOCALAPPDATA%\cn.fitwise.local\EBWebView\` | WebView2 用户数据：**localStorage（界面偏好：钠列显隐/趋势区间/能量单位，见 `src/domain/preferences.ts`）**、缓存、Crashpad、shader cache | 每次启动 | `manager/webview.rs:563` + 目录实测 |
| 用户自选绝对路径的 `.json` | 手动导出 | 仅用户经对话框触发；`create_new(true)` 原子创建、**绝不覆盖既有文件**、限 64MB | `data_diagnostics.rs:45-82` |
| 日志文件 | **无**（无 tauri-plugin-log，Cargo.toml 仅 tauri-plugin-dialog 一个插件） | — | Cargo.toml + 全模块 grep |
| 临时目录 | 生产代码**无**写入（`temp_dir` 仅出现在 `#[cfg(test)]` 测试） | — | 全模块 grep |

- **已验证事实**：生产模块（body_commands/food_library/meal_corrections/recipes/record_commands/recipe_meal_commands/workout_commands/domain_commands）无任何文件系统写入；写操作集中于 `domain_store.rs`（库）、`domain_upgrade.rs`（备份）、`data_diagnostics.rs`（用户主动导出）。
- **推测（低置信）**：WebView2 可能因自身组件更新在 EBWebView 目录内产生新子目录——与隔离方案无冲突，但测试后目录元数据可能变化，核对时需知悉。

### 3.4 单实例机制 —— ✅ 不存在

- `src-tauri` 全目录 grep `single_instance|single-instance`：**无匹配**；`Cargo.toml` 无 `tauri-plugin-single-instance`；`tauri.conf.json` 无插件配置。
- **已验证事实**：0.9.1 实例不会激活、接管或拒绝与 0.9.0 并存；两个进程可同时运行。但这不等于安全——同库并发会触发 SQLite `busy_timeout` 锁竞争，且共用 WebView2 profile（localStorage 并发写）。

### 3.5 启动时自动寻找/迁移/修改真实数据库的行为 —— ⚠️ 不会「寻找」，但会直接打开真实库

打开即执行链（`domain_store.rs: open_database`）：

1. `Connection::open(app_data_dir/fitwise.db)` —— 不存在则**新建**；存在则打开。路径固定为真实库路径（3.2），无任何环境变量覆盖点（grep `env::var|env!`：生产代码仅 `temp_dir`/`current_exe`/`CARGO_PKG_VERSION`）。
2. `PRAGMA foreign_keys / busy_timeout`。
3. `domain_upgrade::upgrade`：若 `domain_upgrade_reports` 已有 version=12 记录 → **直接返回**（真实库已有该记录 → no-op）。
4. `ensure_repository_schema`：对 user_version=14 库为 no-op（合成测试 `legacy_database_opens_under_0_9_1_without_any_migration_or_data_change` 证明信封字节级不变）。
5. `import_legacy_state`：只读**同一库内** `app_kv` 表，不会去其他目录找库。

- **已验证事实**：0.9.1 启动**不会扫描/寻找**真实库——它打开的就是真实库本身。对 v14 真实库，启动过程结构零变更；但**任何录入/更正/重置操作都会直接写入真实数据**（`reset_domain_records` 单事务清空真实记录）。
- **结论**：「只启动不录入」结构无损，但功能验收必然写入 → 同用户运行不可接受。

### 3.6 用仅含合成数据的独立目录完成核心功能测试 —— ⚠️ 需换隔离载体

- 「独立环境变量」已不可行（3.2）→ 同用户免安装运行 = 操作真实库，**不可接受**。
- **虚拟机内可行**：0.9.1 在全新用户配置文件下首启 → 自动建 v14 合成库 → 全部核心功能（录入、纠错、菜谱、R1 菜谱入餐、R2 篮子、R3 照搬、OBS-006 食材管理、JSON 导出、升级报告查询）均可验收；VM 内需自备 WebView2 Evergreen Runtime。
- **第二本地用户可行**：KnownFolder API 按访问令牌解析 → 该用户拥有独立的 Roaming/Local AppData；且现有真实库目录的 ACL 默认拒绝其他用户访问（构成额外保护，即使路径拼错也落足该用户自己的新目录）。
- **已验证事实**：无单实例（3.4）+ 无路径覆盖（3.2）意味着「隔离」只能靠**改变运行身份/运行环境**实现，不能靠启动参数。

### 3.7 验证测试前后正式版 0.9.0 与真实库未受影响的方案 —— ✅ 元数据级方案成立

遵守既有纪律：**只查元数据（存在/大小/时间戳），不读库内容、不算真实库哈希**。

| 时点 | 动作 |
|---|---|
| 测试前 | ① 记录 `%APPDATA%\cn.fitwise.local\` 与 `%LOCALAPPDATA%\cn.fitwise.local\` 全部文件的存在/大小/mtime 清单；② 记录 `C:\Program Files\轻衡\` 同清单；③ `tasklist` 确认 `fitwise-local.exe` 进程数 = 0；④ 记录候选 exe/MSI 哈希备用 |
| 测试窗口期 | **不启动正式版 0.9.0**（否则其正常写入会造成「差异」误判） |
| 测试后 | 同口径逐项比对；任何非预期差异 → 触发停止条件并报告 |
| 辅助 | 应用内 `get_runtime_diagnostics` 命令报告 databasePath/processId/executablePath——但它报告的是**当前实例自己**的库，不能用于验证真实库；仅可用于确认测试实例实际使用的路径符合预期 |

- **注意**：真实库在测试期间被 0.9.0 自身正常写入**不算异常**（前序会话已确认该口径）；判定基准是「测试程序未造成非预期变化」。

### 3.8 该方案无法覆盖的验收项目 —— ⚠️ 明确清单

免安装路线（无论何种隔离载体）**不能覆盖**：

1. **MSI 安装交互**：UAC 提权、per-machine 安装位置（`C:\Program Files\轻衡\`）、开始菜单快捷方式、卸载项与注册表、安装日志；
2. **0.9.0 → 0.9.1 真实就地升级**（覆盖安装 + 首启 + 数据对账）；
3. **备份/恢复实测**（`BUILD_REPORT_0.9.1.md` 第 7 节已列为需单独授权项）；
4. **WebView2 Runtime 缺失场景**（免安装运行要求宿主/VM 已装 Evergreen Runtime；全新 Windows 镜像场景只有 MSI 路线能顺带暴露）；
5. **NSIS 备选安装器**、降级路径（重装 0.9.0 + 重新导出）、GitHub 发布（tag/Release/附件）。

虚拟机路线的额外收益：在 VM 内安装 MSI 可**同时**覆盖第 1、4 项（VM 内可模拟全新环境）。

---

## 4. 隔离机制证据链汇总

| # | 断言 | 证据 | 位置 |
|---|---|---|---|
| E1 | DB 路径 = `{RoamingAppData}\cn.fitwise.local\fitwise.db` | 代码调用链 | `domain_store.rs:36-40` → `tauri-2.12.4/path/desktop.rs:251` → `dirs-7.0.0/win.rs:10` → `dirs-sys-0.5.0/lib.rs:177,150` |
| E2 | 解析经 `SHGetKnownFolderPath`，不读 `%APPDATA%` 环境变量 | vendored 源码原文 | `dirs-sys-0.5.0/src/lib.rs:150-169` |
| E3 | WebView2 目录 = `{LocalAppData}\cn.fitwise.local\EBWebView`（Windows 强制） | 源码 + 目录实测 | `tauri-2.12.4/src/manager/webview.rs:563-570`；`%LOCALAPPDATA%\cn.fitwise.local\EBWebView` 存在 |
| E4 | 0.9.0/0.9.1 标识符相同 → 路径相同 | git conf 对比 | `git show v0.9.0:src-tauri/tauri.conf.json` vs HEAD（仅 version 差异） |
| E5 | 无单实例机制 | 全目录 grep 无匹配 | `src-tauri/` |
| E6 | 无 DB 路径环境变量覆盖点 | grep `env::var\|env!` 仅 temp_dir/current_exe/CARGO_PKG_VERSION | `src-tauri/src/` |
| E7 | 打开真实 v14 库结构零变更（no-op 迁移） | 合成测试结论 + upgrade 早退逻辑 | `BUILD_REPORT_0.9.1.md` 第 4 节；`domain_upgrade.rs:82-93` |
| E8 | 生产写文件仅三处 | 全模块 grep | `domain_store.rs`/`domain_upgrade.rs`/`data_diagnostics.rs` |
| E9 | 候选 exe ↔ 候选 MSI 对应 | FileSize 9,380,352 + Version 0.9.1.0 双匹配 | MSI File 表只读查询 |
| E10 | 生产 0.9.0 安装位置与版本 | `C:\Program Files\轻衡\fitwise-local.exe` 0.9.0 | 目录清单 + 版本信息 |

---

## 5. 可行隔离路径对比

| 路径 | 隔离有效性 | 宿主机系统改动 | 与候选 MSI 对应性 | 主要成本 | 评估 |
|---|---|---|---|---|---|
| **A. 完整虚拟机**（Hyper-V Gen2 / VMware / VirtualBox） | 完全隔离（独立系统盘与用户配置文件） | **无**（Hyper-V 已随沙盒准备启用；但沙盒失败原因未定，**VM 可用性需先做一次最小验证，不能假设**） | 可安装候选 MSI，同时覆盖安装验收 | VM 内装 WebView2 Runtime、拷贝 MSI、快照管理 | **推荐** |
| **B. 第二本地用户账户** | 有效（KnownFolder 按令牌解析；真实库 ACL 拒绝跨用户访问） | 创建本地账户（持久系统改动，需授权） | 免安装 exe 直接可测 | 账户凭据管理、runas 操作 | 可行，次选 |
| **C. 改 `tauri.conf.json` `appDirectoriesOverride` + 重新构建** | 彻底（编译期指定独立目录） | 源码改动（违反本轮禁令） | **不对应**——产物≠候选 MSI，违背「所测即所发」 | 需重新构建 + 候选件重新出 | 仅作「非候选构建冒烟」备选 |
| **D. 临时移走真实库再运行** | 部分 | 触碰真实库位置（违反本轮禁令） | 对应 | 移走/还原有丢失风险 | **不推荐** |
| **E. Windows Sandbox** | — | — | — | — | 已判定失败并停止（前序诊断：默认配置与 VGpu=Disable 对照均失败） |

---

## 6. 启动前检查清单（若后续授权执行，以虚拟机路线为例）

1. 宿主机：确认无 `fitwise-local.exe` 进程；记录 3.7 节全部元数据快照；
2. VM：确认可启动并出现可操作桌面；确认 VM 内无旧 fitwise 数据；
3. VM：安装 WebView2 Evergreen Runtime（VM 内下载不影响宿主机）；
4. 候选件校验：VM 内对拷贝进来的 exe/MSI 重算 SHA-256，与 `36b4838b…` / `cdebbe17…` 一致；
5. 记录 VM 快照，便于每轮功能验收后回滚；
6. 明确本轮验收范围（建议：核心录入链路 + R1/R2/R3 + OBS-006 + 导出，不碰重置命令）。

---

## 7. 停止条件

出现以下任一情况，立即停止验收并报告，不继续操作：

1. 宿主机 `%APPDATA%\cn.fitwise.local\` 或 `%LOCALAPPDATA%\cn.fitwise.local\` 出现非预期变化（排除 0.9.0 自身正常写入的口径争议——测试窗口期内 0.9.0 不得启动，故任何变化都视为异常）；
2. VM 内候选件哈希与记录不符；
3. 发现 0.9.1 实际打开路径与 `%APPDATA%\cn.fitwise.local\fitwise.db` 不符（立即停止并重估隔离假设）；
4. 0.9.1 启动异常/崩溃且原因不明；
5. 任何超出已授权范围的操作诱惑（安装到宿主机、读真实库、重置命令）。

---

## 8. 清理方案

1. VM：删除 VM 或还原到测试前快照；VM 内产生的全部数据随 VM 一并销毁，宿主机零残留；
2. 宿主机：删除本轮拷贝进 VM 用的临时副本（如有）；
3. 元数据快照文件留存备查（仅含路径/大小/时间戳，不含库内容）；
4. 不卸载/不修改正式版 0.9.0，不改 Sandbox/驱动/组策略。

---

## 9. 覆盖缺口汇总（本方案之外必须另行验收的项目）

MSI 安装交互、真实就地升级（0.9.0→0.9.1）、备份/恢复、WebView2 缺失场景、NSIS 安装器、降级路径、GitHub 发布。其中前三项在 `BUILD_REPORT_0.9.1.md` 第 6/7 节已有清单，均**需单独授权**。

---

## 10. 下一阶段需单独授权的事项

1. **虚拟机功能验收**（推荐）：授权创建/使用 VM、VM 内安装 WebView2 Runtime 与候选 MSI（如同时验收安装）、在 VM 内运行 0.9.1 完成第 6 节范围的功能验收；授权范围需明确「仅 VM 内，宿主机只读元数据」。
2. **或第二本地用户验收**：授权创建本地账户（系统改动），以免安装 exe 以该用户身份运行。
3. **或非候选构建冒烟**：授权修改 `tauri.conf.json` 目录覆盖并重新构建（明确知晓产物与候选 MSI 不对应，仅用于功能冒烟，不作为发布依据）。
4. 上述任一选定后，再按 `BUILD_REPORT_0.9.1.md` 第 6/7 节清单申请：真实库受控副本对账、备份恢复实测、正式环境升级、GitHub 发布。

---

## 附：本报告引用的关键只读操作

- vendored 源码：`~/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/` 下 tauri-2.12.4 / dirs-7.0.0 / dirs-sys-0.5.0 / wry-0.57.0 / tauri-runtime-2.12.2 / tauri-runtime-wry-2.12.2
- 应用源码：`src-tauri/src/{domain_store,domain_upgrade,domain_queries,data_diagnostics,lib}.rs`、`src/data/storage.ts`、`src/domain/preferences.ts`
- MSI File 表只读查询（msi.dll，非安装操作）：0.9.1 与 0.9.0 候选 MSI
- 环境元数据：`%APPDATA%\cn.fitwise.local\`、`%LOCALAPPDATA%\cn.fitwise.local\`、`C:\Program Files\轻衡\`、`target/release/` 产物清单与 SHA-256
- 前序会话证据：`SANDBOX_DIAGNOSIS_0.9.1.md`、`SANDBOX_PREPARATION_PLAN_0.9.1.md`、`ISOLATION_ACCEPTANCE_PLAN_0.9.1.md`

**边界声明**：本报告全程未启动 0.9.1 可执行程序、未安装任何 MSI、未读取/复制/哈希/迁移真实数据库、未修改正式版 0.9.0 及其数据、未修改系统/Sandbox/驱动/组策略、未修改源码、未重新构建、未推送 GitHub/未创建 tag 或 Release。所有「已验证事实」均给出处；「推测」已单独标注。
