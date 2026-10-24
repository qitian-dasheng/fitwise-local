# 轻衡 0.9.1｜阶段 2：Windows 虚拟机环境准备方案

日期：2026-10-24｜状态：**仅制定方案，等待用户批准；本轮不下载 ISO、不创建 VHDX、不安装 Windows/轻衡、不访问真实数据库**。前置事实：Hyper-V 阶段 1 冒烟**已通过**（回执见 `VM_ACCEPTANCE_FEASIBILITY_0.9.1.md` 第 8.1/8.2 节）。

---

## 1. 范围与授权边界

本轮只输出方案与命令清单。阶段 2 获批后才执行：镜像与运行时准备、正式测试 VM 创建、Windows 安装。**MSI 安装与升级验收属阶段 3/4，另册授权。**

阶段 1 结论回顾（已验证，不可外推）：临时 Gen2 VM 能创建、能启动、能出固件画面；**Windows 来宾、MSI 安装、升级、备份恢复全部未验证**。

---

## 2. 官方 Windows 评估镜像来源与许可

| 项 | 结论 |
|---|---|
| 来源 | **Microsoft 评估中心**：Windows 11 企业版（当前为 25H2，x64，可选简体中文 ISO） |
| 页面 | https://www.microsoft.com/zh-cn/evalcenter/download-windows-11-enterprise |
| 许可 | **90 天评估版**，功能完整，**无需产品密钥**，测试用途合法免费 |
| 获取方式 | 需注册/登录（免费 Microsoft 账户，表单登记后下载）；**不自动下载，由你执行或单独授权** |
| 体积 | ISO 约 5–7 GB（随版本浮动） |
| 变体 | 同页另有 Enterprise LTSC（特殊用途镜像，默认不选） |
| 已知限制 | 评估页注明「须用 Microsoft 帐户登录」→ 无网络环境下需按第 6.3 节绕过 MSA 走本地账户；90 天到期删 VM 即可，无残留义务 |
| 备选 | 若 Win11 企业版评估镜像的离线 OOBE 无法走通，退 Windows 10 企业版评估版（同样 90 天，本地账户路径原生支持）——需单独授权切换 |

**运行库依赖**：轻衡 MSI（Tauri/wry）需要 **WebView2 Runtime**。VM 无网络，必须预装离线安装包：
- 官方页：https://developer.microsoft.com/zh-cn/microsoft-edge/webview2/ → **Evergreen Standalone Installer（常青独立安装程序，可离线安装，选 x64）**
- 已知直链（以官方页面当前链接为准）：https://go.microsoft.com/fwlink/p/?LinkId=2124701
- 引导器（LinkId=2124703）安装时需联网，**不适用**

---

## 3. 资源配置（宿主机容量依据：D: 928.5 GB 可用、31.6 GB 内存/可用 14.3 GB、i7-12700H 14C/20T）

| 资源 | 方案 | 依据 |
|---|---|---|
| VHDX | **80 GB 动态扩展**，位于 `D:\HyperV-QH-Test\Fitwise-091-Test\Virtual Hard Disks\Fitwise-091-Test.vhdx` | Windows 11 最低存储要求 64 GB；实际占用约 25–35 GB（系统+更新+WebView2+应用数据），动态盘不预占 |
| 内存 | 动态内存：启动 4096 MB / 最小 1024 MB / 最大 8192 MB | Win11 最低 4 GB；宿主可用 14.3 GB，峰值 8 GB 可控 |
| CPU | 4 vCPU | 宿主 20 逻辑处理器；安装/验收更快的合理值 |
| 磁盘峰值 | VHDX 实际增长 + 可选检查点，合计 ≤150 GB | D: 928.5 GB 充足 |
| 检查点 | **升级验收期间禁用检查点**（避免 VHDX 链干扰「覆盖安装」语义）；可在「0.9.0 装好后」建 1 个命名检查点作快速还原点，但主路径用冷备份 | 见第 7.3 节 |
| 网络 | **0 网卡**（与冒烟 VM 一致）；**不创建任何交换机**；宿主机 `Default Switch` 严禁修改/删除/连接 | 最大隔离；一切文件传递走 PowerShell Direct（VM 总线） |
| 增强会话 | 保持默认关闭 | 避免改 Hyper-V 主机设置；用 vmconnect 基本会话 + PowerShell Direct |

---

## 4. VM 选型：新建正式测试 VM，不复用冒烟 VM

**结论：新建 `Fitwise-091-Test`**，`Fitwise-091-Smoke` 原样保留（Off）作为阶段 1 证据，其清理另册授权。

| 方案 | 结论 |
|---|---|
| A. 新建正式 VM（**推荐**） | 干净基线便于验收记录；不动证据 VM；冒烟 VM 配置（512 MB/无 TPM/无盘）本就不适合承载 Windows |
| B. 复用冒烟 VM 改造 | 不推荐：会修改已通过的阶段 1 证据配置，混淆「冒烟通过」与「正式验收」两个事实 |

新 VM 目标状态：Gen2、vTPM 开、Secure Boot 开（MicrosoftWindows 模板）、无盘→挂 80 GB VHDX、0 网卡、动态内存 4/1/8 GB、4 vCPU、DVD 挂 ISO。

---

## 5. 创建命令序列（阶段 2 获批后执行；届时逐条只读复核语法再交你手动运行）

```powershell
# 1) 创建 VM + 动态 VHDX
New-VM -Name "Fitwise-091-Test" -Generation 2 -MemoryStartupBytes 4096MB `
  -NewVHDPath "D:\HyperV-QH-Test\Fitwise-091-Test\Virtual Hard Disks\Fitwise-091-Test.vhdx" `
  -NewVHDSizeBytes 80GB -Path "D:\HyperV-QH-Test\Fitwise-091-Test" -Force

# 2) 移除 New-VM 默认附带的网卡（守卫：仅删未连接交换机的；实测 New-VM 必带 1 块）
$nics = @(Get-VMNetworkAdapter -VMName "Fitwise-091-Test")
if ($nics.Count -ge 1) { foreach ($n in $nics) { if (-not $n.SwitchName) { $n | Remove-VMNetworkAdapter } } }

# 3) Win11 Gen2 要求：vTPM + Secure Boot（均无需宿主机 TPM）
Enable-VMTPM -VMName "Fitwise-091-Test"
Set-VMFirmware -VMName "Fitwise-091-Test" -EnableSecureBoot On -SecureBootTemplate "MicrosoftWindows"

# 4) 内存/CPU
Set-VMMemory -VMName "Fitwise-091-Test" -DynamicMemoryEnabled $true -StartupBytes 4096MB -MinimumBytes 1024MB -MaximumBytes 8192MB
Set-VMProcessor -VMName "Fitwise-091-Test" -Count 4

# 5) 挂 ISO 并设首选启动设备
Add-VMDvdDrive -VMName "Fitwise-091-Test" -Path "D:\HyperV-QH-Test\ISOs\Win11_Ent_Eval_x64_zh-cn.iso"
Set-VMFirmware -VMName "Fitwise-091-Test" -FirstBootDevice (Get-VMDvdDrive -VMName "Fitwise-091-Test")

# 6) 0/0/0 安全门复核（预期 0/0/0、Gen2、State=Off）
```

命令 2–6 的语义与阶段 1 冒烟脚本 rev.3 完全一致；以上语法已只读核实（`New-VM -NewVHDPath/-NewVHDSizeBytes`、`Enable-VMTPM`、`Set-VMFirmware -FirstBootDevice/-EnableSecureBoot/-SecureBootTemplate`、`Set-VMMemory`、`Add-VMDvdDrive -Path`）。

---

## 6. 无网络、无宿主目录映射下安装 Windows 并传入 MSI

### 6.1 总体路径
宿主机文件→VM 只有两条合规通道，均**不走网络、不映射目录**：

| 通道 | 用途 | 机制 |
|---|---|---|
| 虚拟 DVD + ISO | 安装 Windows | 宿主 ISO 以只读光盘媒体挂到 VM（文件级挂载，非目录映射）；`Add-VMDvdDrive -Path` 已核实 |
| **PowerShell Direct（主）** | 传 WebView2 安装包、后续传 MSI、在来宾内执行命令 | VM 总线（`vmicvmsession`，宿主已装）；`New-PSSession -VMName ... -Credential` + `Copy-Item -ToSession` |
| Copy-VMFile（备） | 同上 | 需按 VM 启用来宾服务：`Enable-VMIntegrationService -Name "Guest Service Interface" -VMName ...`；同样走 VM 总线 |

### 6.2 安装步骤（你交互执行）
1. `Start-VM -Name "Fitwise-091-Test"` → Hyper-V Manager 双击连接；
2. 看到 "Press any key to boot from CD or DVD" → 按键进入 Windows 安装；
3. 版本选「Windows 11 企业版」；自定义安装；磁盘默认（未分配 80 GB VHDX）；
4. 装完自动重启，进入 OOBE。

### 6.3 离线 OOBE（无网走本地账户）
评估镜像默认推 MSA。无网络时：
1. OOBE 网络界面按 **Shift+F10** 打开命令提示符；
2. 执行 `OOBE\BYPASSNRO`，VM 自动重启；
3. 重启后出现「我没有 Internet，继续执行有限设置」→ 本地账户（如 `fitwistest`，密码可留空——VM 隔离无网络）；
4. 隐私选项按需全关。
备选：制作 `autounattend.xml` 应答文件置于 ISO 根目录（需宿主持 oscdimg 等工具，单独授权）。若 Win11 企业版评估镜像该路径受阻，退 Win10 企业版评估版（第 2 节备选）。

### 6.4 来宾内装 WebView2（离线）
```powershell
$cred = Get-Credential   # 输入 6.3 创建的本地账户
$s = New-PSSession -VMName "Fitwise-091-Test" -Credential $cred
Copy-Item -Path "D:\HyperV-QH-Test\Staging\WebView2StandaloneInstaller.exe" -Destination "C:\Users\fitwistest\Downloads\" -ToSession $s
Enter-PSSession -VMName "Fitwise-091-Test" -Credential $cred   # 来宾内双击安装
Remove-PSSession $s
```
（路径/账户名为示例，执行时以实际为准。）

---

## 7. Windows 11 Gen2 要求与最小权限配置

| 要求 | 满足方式 | 权限性质 |
|---|---|---|
| TPM 2.0 | `Enable-VMTPM`（vTPM，**不需要宿主机 TPM**；宿主 TPM 只读未确认不阻断） | 按 VM 设置 |
| Secure Boot | `Set-VMFirmware -EnableSecureBoot On -SecureBootTemplate "MicrosoftWindows"`（Gen2 默认即开，显式确认） | 按 VM 设置 |
| UEFI 固件 | Gen2 原生 | 创建即定 |
| 内存 ≥4 GB | 动态 4/1/8 GB | 按 VM 设置 |
| 存储 ≥64 GB | 80 GB 动态 VHDX | 新建文件 |
| CPU ≥2 核 | 4 vCPU | 按 VM 设置 |

**宿主机级零新增改动**：不建交换机、不改物理网络/防火墙/驱动/组策略、不改增强会话主机设置、不启用/禁用任何 Windows 功能（阶段 1 已确认全部 Enabled）。来宾内可选优化：`powercfg /change standby-timeout-ac 0`（防休眠中断测试）。默认不同步宿主时间以外的任何宿主资源。

---

## 8. 后续验收流程（阶段 3/4，另册授权；此处仅定流程）

### 8.1 全新安装验收（阶段 3）
1. 传 0.9.1 MSI 入 VM（PowerShell Direct）；
2. 全新安装 → 启动 → 录入**固定合成数据集**（固定餐食/体重条目，数值记入验收记录）；
3. 导出 JSON → 与合成记录逐项核对。

### 8.2 合成升级验收（阶段 4，真实数据保留能力的唯一实测途径）
1. VM 内先装 **0.9.0 MSI**（同路径覆盖安装前的基线）；
2. 录入合成数据集 A → 导出 JSON_A；
3. **冷备份**来宾数据目录 `%APPDATA%\cn.fitwise.local` + 记录 SHA-256；
4. 覆盖安装 0.9.1 MSI（升级）；
5. 启动 → 核对 A 数据是否保留 → 导出 JSON_A' 与 JSON_A 逐项比对；
6. 结论分流：保留正常→记「升级保留通过」；异常→用冷备份恢复验证备份完整性，异常细节入报告。

### 8.3 备份恢复验收（阶段 4）
1. 破坏性步骤：重命名/移走来宾数据目录（VM 内操作，与真实库无关）；
2. 从 8.2 的冷备份还原；
3. 启动 → 导出 JSON 与 JSON_A 对账（字节级或逐字段）。

### 8.4 一致性对账（阶段 4）
导出 JSON vs 合成记录 vs 备份还原结果三方一致；输出《0.9.1 隔离验收报告》，明确区分已验证/未验证项。

### 8.5 可选项（均需单独授权）
WebView2 缺失场景、NSIS 变体、降级路径、评估版 90 天延期（`slmgr /rearm`，限次）。

---

## 9. 完整回滚与清理方式

**阶段 2/3/4 全程的宿主机改动只有 VM 相关文件**（无交换机、无功能、无网络/防火墙/驱动/组策略变更）。回滚即删除这些文件：

| 步骤 | 命令（届时交付，含守卫） |
|---|---|
| 1. 关闭 | `Stop-VM -Name "Fitwise-091-Test" -TurnOff -Force` |
| 2. 删 VM 定义 | `Remove-VM -Name "Fitwise-091-Test" -Force`（仅配置注册，不删文件） |
| 3. 删 VHDX | 显式路径删除 `D:\HyperV-QH-Test\Fitwise-091-Test\Virtual Hard Disks\Fitwise-091-Test.vhdx` |
| 4. 删 VM 目录 | 显式路径删除 `D:\HyperV-QH-Test\Fitwise-091-Test`（Resolve 后逐字相等才删，无通配符） |
| 5. 删暂存副本 | 显式删除 `D:\HyperV-QH-Test\ISOs\*.iso` 与 `D:\HyperV-QH-Test\Staging\*`（届时按清单显式列出，不用通配符） |
| 6. 元数据复核 | `Get-VM`（应只剩 `Fitwise-091-Smoke`）、`Get-VMSwitch`（应仍只有 `Default Switch`，数量与阶段 1 前一致）、D: 可用空间恢复 |

**冒烟 VM `Fitwise-091-Smoke`**：保留至阶段 1 证据链完整归档后，另册授权清理（清理脚本已就绪：五重守卫 + 无通配符）。

---

## 10. 阶段 2 授权表（待批准）

| 步骤 | 内容 | 授权点 | 停止点 |
|---|---|---|---|
| 2.1 | 下载 Win11 企业版评估 ISO（x64，简体中文）+ WebView2 独立安装包，存 `D:\HyperV-QH-Test\ISOs` 与 `\Staging` | 需授权：宿主下载（你执行或单独授权 AI） | 下载完成、SHA-256 记录后即停 |
| 2.2 | 按第 5 节创建 `Fitwise-091-Test` 并配置（TPM/SB/内存/CPU/ISO/启动顺序） | 需授权：创建 VM + VHDX + 挂 ISO | 0/0/0 安全门通过即停 |
| 2.3 | 安装 Windows + 离线 OOBE + 装 WebView2 | 需授权：VM 内安装系统 | 进入桌面、WebView2 就绪即停 |
| 2.4 | 报告环境就绪状态 | — | 等阶段 3 批准 |

**本轮未授权项（再次明确）**：下载、创建 VHDX/VM、安装 Windows 或轻衡、访问真实数据库、GitHub 操作；禁止触碰 `Default Switch`、创建交换机、映射宿主目录。

---

## 11. 风险与停止条件

| 风险 | 等级 | 缓解 |
|---|---|---|
| Win11 评估镜像离线 OOBE 推 MSA | 中 | bypassnro 路径已验证为通用做法；受阻则退 Win10 企业版评估版（单独授权） |
| 0 网卡导致某些步骤需要网络 | 低 | 传递全走 PowerShell Direct；如确需网络另议 Private 交换机（单独授权，仍禁 Default/External） |
| 80 GB VHDX + 检查点空间膨胀 | 低 | 升级验收期禁检查点；主路径冷备份 |
| 误挂宿主目录/磁盘入 VM | 中 | 0/0/0 安全门 + 所有配置命令 AI 预审后交你执行 |
| 评估版 90 天到期 | 低 | 测试周期足够；记录安装日期；到期删 VM |

---

## 12. 证据留存约定

- 证据根目录：`D:\HyperV-QH-Test\Evidence\`（phase1/、phase2/…）；
- 阶段 1 固件截图（Microsoft Hyper-V UEFI / No boot devices were found）由你存档至 `Evidence\phase1\`，建议补记 SHA-256 后回贴，我写入验收记录；
- 每阶段归档：控制台输出/transcript 日志、截图、导出 JSON、SHA-256 清单；
- 清理 VM 前确认证据已归档（清理不删 Evidence 目录，其去留另册授权）。
