# 轻衡 0.9.1｜Windows Sandbox 隔离验收环境准备方案

日期：2026-10-24｜状态：**Sandbox 功能已启用并重启；首启失败（黑屏 → 0x80072746 连接丢失），沙盒启动验收记为「失败，待诊断」，隔离验收未开始**。诊断见 `SANDBOX_DIAGNOSIS_0.9.1.md`。
本轮（截至 17:40）未执行：管理员命令、功能启用/关闭、重启、MSI 安装、真实库读取、源码修改、GitHub 操作、系统配置修改。

---

## 一、兼容性核实（实测，不以版本名称想当然）

### 1.1 本机实测事实

| 项目 | 实测值 | 判定 |
|---|---|---|
| CurrentBuild / UBR | **26200.9711** | 经微软发布信息文档证实：**26200 = Windows 11 25H2**（25H2 即 OS build 26200） |
| 注册表 ProductName 字符串 | "Windows 10 Pro for Workstations" | ⚠️ **与构建号矛盾**：这是映像自定义的品牌字符串，真实内核是 Windows 11 25H2（构建 26200）。以构建号与 CBS 组件版本为准 |
| EditionID | ProfessionalWorkstation | ✅ Pro 家族，Sandbox 支持（Win11 Pro/Enterprise/Education） |
| 架构 / 安装类型 | amd64 / Client | ✅ |
| 虚拟化 | HypervisorPresent = True | ✅（Sandbox 不需要 Hyper-V 角色） |
| Sandbox 组件在镜像内 | CBS 存在 `Containers-DisposableClientVM-Package~…~10.0.26100.9711`（组件为 26100 基线、UBR 9711 与 OS 的 26200.9711 相同但基线不同；10-24 只读核实 CurrentState=112＝已安装） | ✅ 已启用 |
| WindowsSandbox.exe | 16:05 时不存在 → 16:43 重启后**存在**（FileVersion 10.0.26100.8875，mtime 10-20） | ✅ 功能已启用 |
| 资源 | 内存 31.6 GB（可用 10.5 GB）、C 盘余 581 GB | ✅ 充足 |
| WebView2 | 宿主机运行时 155.0.4283.62；CBS 存在 `Microsoft-Edge-WebView-FOD-Package~…~10.0.26100.9711`（Win11 内置 FOD） | 🟡 沙盒内大概率随镜像可用，**需首启实测** |

### 1.2 待确认事项（2026-10-24 17:40 更新）

1. ~~DISM 精确功能状态~~ → 你已以管理员命令确认 `Containers-DisposableClientVM = Enabled`；只读佐证：CBS CurrentState=112。
2. 沙盒首启实测：**失败**——窗口可开、黑屏约 3 分 10 秒后 VM 拆除、弹 0x80072746。根因诊断与只读证据见 `SANDBOX_DIAGNOSIS_0.9.1.md`（当前最可能方向：vGPU/GPU-PV；下一候选验证手段＝仅含 `VGpu=Disable` 的 .wsb，待批准）。
3. ~~开始菜单入口缺失~~ → **已排除**（你确认英文关键词「windows sandbox」可找到并「打开」；中文无结果属搜索匹配问题）。
4. 我的执行 shell 能否启动沙盒：仍未验证（本轮沙盒由你手动启动）；若后续被安全策略拦截，仍由你手动双击 `.wsb`，我提供点击清单。注意：本会话 Bash 禁止调用 powershell.exe，只读诊断已改用 PowerShell 工具执行。

## 二、启用 Windows Sandbox：改动、重启与恢复

**启用命令（管理员，二选一，获批后执行）：**
```powershell
Enable-WindowsOptionalFeature -Online -FeatureName "Containers-DisposableClient-Virtualization" -All
# 或 DISM：Dism /Online /Enable-Feature /FeatureName:"Containers-DisposableClient-Virtualization" /All /NoRestart
```

- **宿主机改动范围**：系统组件文件进入 WinSxS（数百 MB）；开始菜单出现 "Windows Sandbox" 入口。**不**启用 Hyper-V 角色、**不**加开机服务、**不**改网络配置、不影响已装应用与数据。
- **重启**：通常需要一次重启完成生效（可先试 `-NoRestart`，但首次启动仍可能要求重启）。
- **恢复方式**（完全可逆）：
  `Disable-WindowsOptionalFeature -Online -FeatureName "Containers-DisposableClient-Virtualization"`（+重启），或对应 DISM disable 命令。
- **运行时占用**：沙盒启动期动态内存 + 临时 VHD（预计 1–5 GB 量级），关闭即释放，宿主机无残留。

## 三、沙盒配置（.wsb）

- **只读映射一个且仅一个文件夹**：`%LOCALAPPDATA%\Temp\fitwise-091-verify`，其中**只放候选 MSI**（放入前校验 SHA-256 = `cdebbe17…b1bd`，与交付报告一致）。
- **明确不映射**：用户主目录、`%APPDATA%`（含 `cn.fitwise.local`）、任何 `.db`/备份文件、Downloads/Documents/Desktop。
- **网络默认禁用**（`Networking=Disable`）；仅在沙盒内确认缺 WebView2 且宿主机预下载方案也失败时，才提请你单独批准开网（见 4.2）。
- 剪贴板/音频重定向默认禁用；验收结果以我的操作记录 + 截图形式汇报（只读映射无法回写文件；如需文件输出将单独申请）。
- vGPU 默认启用；若沙盒内渲染异常，评估软件渲染路径后继续。

## 四、数据隔离设计（最高优先级）

### 4.1 隔离原理与证据链

沙盒是一次性容器，拥有独立临时配置文件：沙盒内 `%APPDATA%\cn.fitwise.local` **初始不存在**，应用首启将创建全新合成库；宿主机真实库不被读、写或迁移。用"前后快照"证明：

| # | 快照项（全部只读） | 预期 |
|---|---|---|
| a | `C:\Program Files\轻衡` 目录树清单 + SHA-256 | 完全不变 |
| b | 卸载注册表项 DisplayVersion | 恒为 0.9.0 |
| c | 开始菜单快捷方式目标/时间戳 | 完全不变 |
| d | `%APPDATA%\cn.fitwise.local` 文件清单 + SHA-256（只看元数据与哈希，不解析内容） | 完全不变 |
| e | 宿主机 tasklist 中 fitwise 进程 | 不出现 0.9.1 进程 |

### 4.2 WebView2 专项（如需联网才处理）

- **必要性**：轻衡是 Tauri 应用，依赖 WebView2 运行时。Win11 以 FOD 形式内置 WebView2（本机 CBS 已证实存在对应 FOD 包），沙盒镜像大概率自带——**先实测，不预设需要联网**。
- **若沙盒内确认缺失**：优先方案为**宿主机单次下载**官方引导程序（`MicrosoftEdgeWebView2RuntimeInstaller.exe`，Microsoft 官方域）放入只读映射文件夹，沙盒内**离线**安装；沙盒全程保持禁网。
- **网络风险说明**：仅宿主机一次官方域下载、仅引导程序本身、无浏览行为；沙盒网络保持禁用。该下载需你在批准启用功能时一并勾选同意；若不同意，直接转退路 D。

## 五、执行步骤（获批后）

| 步骤 | 内容 |
|---|---|
| S0 | 你批准；由你或经你允许由我执行启用命令 + 重启 |
| S1 | 我建只读映射文件夹（仅 MSI + 哈希校验）+ 写 `.wsb`（只读映射、禁网络、禁剪贴板） |
| S2 | 宿主机"前快照"（4.1 表 a–e） |
| S3 | 空跑启动沙盒：确认沙盒可用、确认沙盒内 `cn.fitwise.local` 不存在、确认 WebView2 可用性 |
| S4 | 沙盒内安装 MSI（从映射拷出 → `msiexec /i`）→ 启动 → 创建**合成**数据（合成食材/菜谱/餐食/体重，绝不用真实数据） |
| S5 | 按 9 项验收清单逐项点验并记录操作次数 |
| S6 | 关闭沙盒 → 宿主机"后快照"比对 → 输出《隔离证明 + 验收记录》 |

## 六、失败与停止条件 + 替代方案

- **启用失败**（报错/需额外许可）→ 停止，不碰其他任何系统设置，报告错误码；
- **沙盒无法启动** → 停止，不转而尝试其他安装方式；
- **沙盒内缺 WebView2 且预下载方案未获同意** → 停止安装验收环节；
- **我的 shell 被安全策略拦截启动沙盒** → 你手动双击 `.wsb`，我提供逐步点击清单；
- **任何一项宿主机快照发生变化** → 立即停止并报告。

**替代方案（均不覆盖正式版、不读真实库）**：
- **D（无网络、无系统变更）**：直接运行仓库 release 目录的 `fitwise-local.exe`，以重定向 `APPDATA`/`LOCALAPPDATA` 到临时目录的方式隔离数据——宿主机已有 WebView2，立即可跑；**但不验证 MSI 安装本身**，只作功能冒烟。
- **C**：安装 VirtualBox 等虚拟机完整验收（需另装虚拟化软件，最重）。

## 七、本轮明确不做

不执行管理员命令、不启用系统功能、不重启、不安装 MSI、不读取/复制/迁移真实数据库、不修改源码、不提交/推送、无 GitHub 操作。

---

**请你单独批准：① 是否启用 Windows Sandbox（含一次重启）；② 是否同意 4.2 的宿主机官方域单次下载（仅沙盒内确认缺 WebView2 时才发生）。** 批准后我按第五节执行；未批准前停留在本方案。

---

## 八、执行状态（2026-10-24 16:05，启用授权后）

**已完成（只读）**：shell 权限状态确认（未提权）；`WindowsSandbox.exe` 不存在；CBS 中存在当前映像的 `Containers-DisposableClientVM-Package`（仅作指示，未据此判定"精确匹配"）。已备好启用脚本 `%TEMP%\fitwise-enable-sandbox.ps1`（先查状态→仅启用 Sandbox 一个功能→`-NoRestart`→结果写 `%TEMP%\fitwise-sandbox-enable.log`）。

**遇到阻塞**：从本会话 shell 触发提权执行（`Start-Process -Verb RunAs`）被命令安全策略拦截（解释器子进程绕过校验）。**已按停止条件立即停止，未尝试任何变通提权或系统级修改**；未安装 MSI、未读真实库内容、未改源码、无 GitHub 操作。

**待你执行（二选一）**：
1. 推荐：右键开始菜单 →「Windows PowerShell (管理员)」→ 运行
   `powershell -ExecutionPolicy Bypass -File "$env:TEMP\fitwise-enable-sandbox.ps1"`
2. 或单条命令（等效）：
   `Enable-WindowsOptionalFeature -Online -FeatureName "Containers-DisposableClient-Virtualization" -All -NoRestart`

两者都只启用 Sandbox 一个功能（含其必需父包）、不自动重启。执行完请告诉我，我会读取日志文件核验实际状态；若 `RestartNeeded=True`，由你保存工作并决定重启时机，重启后再继续。

---

## 九、首启失败记录（2026-10-24 17:40，已发生事实）

**你已完成**：手动执行启用命令 → 重启（16:43）→ 管理员确认 `Containers-DisposableClientVM = Enabled` → 确认 `WindowsSandbox.exe` 存在 → 开始菜单（英文关键词）入口可用。

**首启结果（17:21–17:26）**：窗口打开 → 黑屏约 3 分 10 秒 → 17:24:52 VM 暂停/拆除 → ≈17:25:47 弹「与沙盒的连接已丢失。Error 0x80072746」。**沙盒启动验收 = 失败，待诊断**（未标记通过，不得进入隔离安装验收）。

**只读诊断结论**（详见 `SANDBOX_DIAGNOSIS_0.9.1.md`）：宿主侧无任何错误事件、资源与服务正常、本地会话、vGPU 为默认启用、混合图形（NVIDIA dGPU 驱动 2026-09-30）；失败发生在沙盒客人内部且其日志通道本机不存在。最可能方向为 GPU-PV/vGPU 兼容性（与大量公开社区报告的错误签名一致，但未经本机验证）。

**N3 对照测试（2026-10-24 17:49 已执行，结果：失败）**：经你批准，按给定配置原样创建 `%TEMP%\fitwise-sandbox-novgpu.wsb`（VGpu=Disable + Networking=Disable + ClipboardRedirection=Disable + 空 MappedFolders，无文件夹映射、无自动启动脚本）**单次启动**。结果：进程约 20–30 秒自行退出，未出现可操作桌面，全程未捕获 0x80072746 弹窗，宿主侧零错误日志。**结论：禁用 vGPU 未能修复，且失败更快**——「仅禁 vGPU 即可修复」的预期被否定；GPU-PV 假设削弱，失败时点前移至更早阶段。证据（截图 20 帧 + watch.log）在 `%TEMP%\fitwise-novgpu-cap\`。

**当前状态与可选方向（均待你另行批准，未执行）**：N2 已跳过、N4 不批准（其前提沙盒可用已不成立）。可选：① 退路 D（免安装 exe + 重定向 APPDATA 做 0.9.1 功能冒烟，零系统改动，不验证 MSI 安装）；② 深层宿主机排查（DISM/驱动/KB/功能重开关，每项触碰系统需逐项授权）；③ 退路 C（装虚拟机）；④ 暂停。

**停止条件**：需要提权/改系统的步骤、新错误码、宿主机快照（`C:\Program Files\轻衡` / `%APPDATA%\cn.fitwise.local` / 开始菜单）任何变化、你叫停。
