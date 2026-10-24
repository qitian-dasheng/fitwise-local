# 轻衡 0.9.1｜阶段 2：Windows 虚拟机环境准备方案

日期：2026-10-24｜状态：**阶段 2.1 已获有条件授权并执行中**（官方镜像/运行库下载与验证；2.2 创建 VM、2.3 安装 Windows、轻衡 MSI 均未批准）；不访问真实数据库。前置事实：Hyper-V 阶段 1 冒烟**已通过**（回执见 `VM_ACCEPTANCE_FEASIBILITY_0.9.1.md` 第 8.1/8.2 节）。

---

## 1. 范围与授权边界

本轮只输出方案与命令清单。阶段 2 获批后才执行：镜像与运行时准备、正式测试 VM 创建、Windows 安装。**MSI 安装与升级验收属阶段 3/4，另册授权。**

阶段 1 结论回顾（已验证，不可外推）：临时 Gen2 VM 能创建、能启动、能出固件画面；**Windows 来宾、MSI 安装、升级、备份恢复全部未验证**。

---

## 2. 官方 Windows 评估镜像来源与许可

| 项 | 结论（2026-10-24 已核实） |
|---|---|
| 来源 | **Microsoft 评估中心**：Windows 11 企业版评估版（**当前为 26H2**，build `26300.9457.260913-1737`，x64，简体中文 ISO 可选） |
| 页面 | https://www.microsoft.com/zh-cn/evalcenter/download-windows-11-enterprise |
| 简体中文直链 | https://go.microsoft.com/fwlink/?LinkId=2382601&clcid=0x804&culture=zh-cn&country=cn （302 → `software-static.download.prss.microsoft.com`，微软官方 CDN） |
| 文件名 | `26300.9457.260913-1737.26h2_ge_release_svc_refresh_CLIENTENTERPRISEEVAL_OEMRET_x64FRE_zh-cn.iso` |
| 体积 | **8,548,628,480 字节**（CDN Content-Length 实测） |
| 许可 | **90 天评估版**，功能完整，**无需产品密钥**；页面注明到期未激活会黑桌+每小时关机——测试用途合法免费，到期删 VM 无残留 |
| 获取方式 | 页面提供注册表单（免费 Microsoft 账户，用于微软评估跟踪）；**文件直链本身无需登录即可下载**；由你执行或单独授权。注册/许可条款由你本人操作 |
| 官方校验 | **KB 5130867**（How to verify the authenticity of a Windows 11, version 26H2 Evaluation ISO）：微软官方公布各语言 SHA-256；**ZH-CN = `B37A06D5121EEE017826C0B133250BBD21BEC694C2D607C60EDD29090E667A84`**。ISO 无 Authenticode 签名，校验＝官方源 HTTPS + 字节大小 + SHA-256 比对 |
| 变体 | 同页另有 Enterprise LTSC（特殊用途镜像，默认不选） |
| 已知限制 | 评估页注明「须用 Microsoft 帐户登录」；Win11 24H2 及之后 OOBE 强制联网+MSA（详见第 6.3 节，含微软支持路径） |
| 备选 | 若离线 OOBE 全部路径受阻，退 Windows 10 企业版评估版（同样 90 天，本地账户路径原生支持）——需单独授权切换 |

**运行库依赖**：轻衡 MSI（Tauri/wry）需要 **WebView2 Runtime**。VM 无网络，必须预装离线安装包：
- 官方页：https://developer.microsoft.com/zh-cn/microsoft-edge/webview2/ → **Evergreen Standalone Installer（常青独立安装程序，可离线安装，选 x64）**
- 直链（2026-10-24 已解析确认）：`https://go.microsoft.com/fwlink/p/?LinkId=2124701` → `msedge.sf.dl.delivery.mp.microsoft.com/.../MicrosoftEdgeWebView2RuntimeInstallerX64.exe`（214,823,632 字节，Authenticode 签名 Microsoft Corporation，已验证）
- 引导器（LinkId=2124703 → `MicrosoftEdgeWebview2Setup.exe`，1.8 MB）安装时需联网，**不采用**

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
Add-VMDvdDrive -VMName "Fitwise-091-Test" -Path "D:\HyperV-QH-Test\Media\26300.9457.260913-1737.26h2_ge_release_svc_refresh_CLIENTENTERPRISEEVAL_OEMRET_x64FRE_zh-cn.iso"
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

### 6.3 离线 OOBE（无网走本地账户）——2026-10-24 修订

**事实基础（已核实）**：
1. Win11 24H2 及之后（含本方案选用的 26H2 build 26300.9457）OOBE **强制联网 + MSA**，评估页自身亦注明「必须使用 Microsoft 帐户登录」；0 网卡时网络页「继续」按钮置灰；
2. **`OOBE\BYPASSNRO` 脚本已被微软从 26200.5516 / 26120.3653 及更新构建中移除**（公开记录引微软说明：确保所有用户以联网+MSA 完成设置）→ **本镜像不含该脚本，不得作为既定步骤**；
3. 已知 25H2 系问题：跳过网络后首次登录可能转圈卡住（CloudExperienceHost/CDPSvc 等后台服务在线超时）——缓解：重启前先禁用首次登录动画（见路径 B），或强制重启一次。

**分级路径（按优先级，全部只用微软文档化手段，不用未知来源脚本）**：

| 级 | 方法 | 依据与边界 |
|---|---|---|
| **A（微软支持，主路径）** | **autounattend.xml 应答文件**：置于**第二块虚拟 DVD 根目录**（Windows 安装程序会检索安装介质/驱动器根目录的应答文件）。内容：`HideOnlineAccountScreens=1`、`HideWirelessSetupInOOBE=1`（`Microsoft-Windows-Shell-Setup`）+ `UserAccounts/LocalAccounts` 建本地管理员 + 跳过 EULA/隐私页 | 微软文档化部署技术（无人参与应答文件）；边界：需确认安装程序确实检索到（不能 100% 保证第二 DVD 被检索——安装时验证，失败即转 B）；若不被检索，用 oscdimg 注入 ISO 需 ADK 工具（另册授权） |
| **B（文档化回退 1）** | OOBE 网络页 **Shift+F10** → `start ms-cxh:localonly` → 弹出本地账户创建对话框，无需重启 | 24H2/25H2/26H2 上多个微软 Q&A/技术记录确认可用 |
| **C（文档化回退 2）** | Shift+F10 → `reg add HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\OOBE /v BypassNRO /t REG_DWORD /d 1 /f` + `reg add HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System /v EnableFirstLogonAnimation /t REG_DWORD /d 0 /f` + `shutdown /r /t 0` → 重启后出现「我没有 Internet」 | 即被移除脚本的两条命令的手动等价（脚本内容本身公开展示过）；微软 Learn 中文问答同路径 |
| **D（微软支持，末选）** | OOBE 首屏 **Ctrl+Shift+F3** 进入审核模式（内置 Administrator） | 微软文档化（Audit Mode）；但账户模型变为内置管理员，与测试账户语义不同，仅当前面全部失败时用 |

**明确不用**：`bypassnro.cmd`（本构建已移除）、第三方 ISO 修改工具（如 Rufus 改写镜像）、任何来源不明的账户绕过脚本。若 A–D 全部失败 → 停止并报告，不自行改用第三方镜像（按用户既定边界）。

**路径 A 应答文件模板**（仅文档预览，获批后才落盘到第二块虚拟 DVD 根目录；字段名以微软无人参与文档为准，有条件时用 ADK Windows SIM 校验）：

```xml
<?xml version="1.0" encoding="utf-8"?>
<unattend xmlns="urn:schemas-microsoft-com:unattend"
          xmlns:wcm="http://schemas.microsoft.com/WMIConfig/2002/State">
  <settings pass="oobeSystem">
    <component name="Microsoft-Windows-Shell-Setup"
               processorArchitecture="amd64" language="neutral"
               scope="oobeSystem"
               publicKeyToken="31bf3856ad364e35">
      <OOBE>
        <HideEULAPage>true</HideEULAPage>
        <HideOnlineAccountScreens>true</HideOnlineAccountScreens>
        <HideWirelessSetupInOOBE>true</HideWirelessSetupInOOBE>
        <HideOEMRegistrationScreen>true</HideOEMRegistrationScreen>
        <ProtectYourPC>3</ProtectYourPC>
      </OOBE>
      <UserAccounts>
        <LocalAccounts>
          <LocalAccount wcm:action="add">
            <Name>fitwistest</Name>
            <Group>Administrators</Group>
          </LocalAccount>
        </LocalAccounts>
      </UserAccounts>
    </component>
  </settings>
</unattend>
```

### 6.4 来宾内装 WebView2（离线）
```powershell
$cred = Get-Credential   # 输入 6.3 创建的本地账户
$s = New-PSSession -VMName "Fitwise-091-Test" -Credential $cred
Copy-Item -Path "D:\HyperV-QH-Test\Media\MicrosoftEdgeWebView2RuntimeInstallerX64.exe" -Destination "C:\Users\fitwistest\Downloads\" -ToSession $s
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

### 8.0 环境就绪判定（阶段 2.3 收尾，逐项打勾再进阶段 3）
1. Windows 11 企业版评估版进入桌面，本地测试账户可登录；
2. WebView2 Runtime 已装（来宾内 `Get-ItemProperty "HKLM\SOFTWARE\WOW6432\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"` 有 `pv` 值，或目录存在 `msedgewebview2.exe`）；
3. **PowerShell Direct 单独验证（不得默认可用）**：宿主机管理员执行 `New-PSSession -VMName "Fitwise-091-Test" -Credential <本地账户>` 成功进入来宾会话，并用 `Copy-Item -ToSession` 传一个小测试文件、在来宾内确认存在；失败则先排查（来宾防火墙/服务/凭据），**不进入后续步骤**；
4. 基线 VHDX 状态记录（文件大小 + SHA-256）。

### 8.0bis 干净状态策略（避免测试交叉污染，用户 2026-10-24 要求）
- **基线**：Windows + WebView2 + PowerShell Direct 验证通过后的 VHDX 视为** pristine 基线**；
- **克隆分流**：VM 关机后把基线 VHDX **整文件复制**为每场景独立磁盘（文件级拷贝，非检查点/差异盘语义）：
  - `Fitwise-091-Test-A.vhdx` → 场景 A：0.9.1 全新安装验收；
  - `Fitwise-091-Test-B.vhdx` → 场景 B：0.9.0→0.9.1 升级验收；
- 两场景从**相互独立的相同干净状态**出发，任何写入互不影响；
- **不用检查点作主路径**（差异链会干扰「覆盖安装」语义与空间核算）；检查点仅作临时快照且命名带日期；
- 场景切换：VM 关机 → 移除当前 VHDX → 挂载下一场景 VHDX（显式路径，VM 配置随附磁盘表核对）。

### 8.1 全新安装验收（阶段 3，场景 A）
1. 传 0.9.1 MSI 入 VM（PowerShell Direct）；
2. 全新安装 → 启动 → 录入**固定合成数据集**（固定餐食/体重条目，数值记入验收记录）；
3. 导出 JSON → 与合成记录逐项核对。

### 8.2 合成升级验收（阶段 4，场景 B——真实数据保留能力的唯一实测途径）
1. 场景 B 磁盘上先装 **0.9.0 MSI**；
2. 录入合成数据集 A → 导出 JSON_A；
3. **冷备份**来宾数据目录 `%APPDATA%\cn.fitwise.local` + 记录 SHA-256；
4. 覆盖安装 0.9.1 MSI（升级）；
5. 启动 → 核对 A 数据是否保留 → 导出 JSON_A' 与 JSON_A 逐项比对；
6. 结论分流：保留正常→记「升级保留通过」；异常→用冷备份恢复验证备份完整性，异常细节入报告。

### 8.3 备份恢复验收（阶段 4，场景 B 继续）
1. 破坏性步骤：重命名/移走来宾数据目录（VM 内操作，与真实库无关）；
2. 从 8.2 的冷备份还原；
3. 启动 → 导出 JSON 与 JSON_A 对账（字节级或逐字段）。

### 8.4 一致性对账（阶段 4）
导出 JSON vs 合成记录 vs 备份还原结果三方一致；输出《0.9.1 隔离验收报告》，明确区分已验证/未验证项。

### 8.5 数据纪律（硬约束）
所有升级、恢复、核对**只用合成数据**；未经单独授权不得读取/复制/哈希/迁移宿主机真实轻衡数据库；VM 内产生的任何数据与宿主真实库物理隔离（0 网卡 + 无目录映射 + 独立 VHDX）。

---

## 9. 完整回滚与清理方式

**阶段 2/3/4 全程的宿主机改动只有 VM 相关文件**（无交换机、无功能、无网络/防火墙/驱动/组策略变更）。回滚即删除这些文件：

| 步骤 | 命令（届时交付，含守卫） |
|---|---|
| 1. 关闭 | `Stop-VM -Name "Fitwise-091-Test" -TurnOff -Force` |
| 2. 删 VM 定义 | `Remove-VM -Name "Fitwise-091-Test" -Force`（仅配置注册，不删文件） |
| 3. 删 VHDX | 显式路径删除 `D:\HyperV-QH-Test\Fitwise-091-Test\Virtual Hard Disks\Fitwise-091-Test.vhdx` |
| 4. 删 VM 目录 | 显式路径删除 `D:\HyperV-QH-Test\Fitwise-091-Test`（Resolve 后逐字相等才删，无通配符） |
| 5. 删暂存副本 | 显式删除 `D:\HyperV-QH-Test\Media\26300.9457.260913-1737.26h2_ge_release_svc_refresh_CLIENTENTERPRISEEVAL_OEMRET_x64FRE_zh-cn.iso` 与 `D:\HyperV-QH-Test\Media\MicrosoftEdgeWebView2RuntimeInstallerX64.exe`（显式全路径，无通配符；删除前确认证据已归档） |
| 6. 元数据复核 | `Get-VM`（应只剩 `Fitwise-091-Smoke`）、`Get-VMSwitch`（应仍只有 `Default Switch`，数量与阶段 1 前一致）、D: 可用空间恢复 |

**冒烟 VM `Fitwise-091-Smoke`**：保留至阶段 1 证据链完整归档后，另册授权清理（清理脚本已就绪：五重守卫 + 无通配符）。

---

## 10. 阶段 2 授权表（待批准）

| 步骤 | 内容 | 授权点 | 停止点 |
|---|---|---|---|
| 2.1 | 下载 Win11 企业版评估 ISO（x64，简体中文）+ WebView2 独立安装包，存 `D:\HyperV-QH-Test\Media` | 需授权：宿主下载（你执行或单独授权 AI） | 下载完成、SHA-256 记录后即停 |
| | **✅ 已完成（2026-10-24，见第 12 节：两文件均已官方源下载+校验通过，未运行）** | | |
| 2.2 | 按第 5 节创建 `Fitwise-091-Test` 并配置（TPM/SB/内存/CPU/ISO/启动顺序） | 需授权：创建 VM + VHDX + 挂 ISO | 0/0/0 安全门通过即停 |
| 2.3 | 安装 Windows + 离线 OOBE + 装 WebView2 | 需授权：VM 内安装系统 | 进入桌面、WebView2 就绪即停 |
| 2.4 | 报告环境就绪状态 | — | 等阶段 3 批准 |

**本轮未授权项（再次明确）**：下载、创建 VHDX/VM、安装 Windows 或轻衡、访问真实数据库、GitHub 操作；禁止触碰 `Default Switch`、创建交换机、映射宿主目录。

---

## 11. 风险与停止条件

| 风险 | 等级 | 缓解 |
|---|---|---|
| Win11 评估镜像离线 OOBE 推 MSA | 中 | 已改分级路径（autounattend.xml 主 + ms-cxh:localonly/手动注册表/审核模式回退；bypassnro 脚本在本构建已移除，弃用）；全败则退 Win10 企业版评估版（单独授权） |
| 0 网卡导致某些步骤需要网络 | 低 | 传递全走 PowerShell Direct；如确需网络另议 Private 交换机（单独授权，仍禁 Default/External） |
| 80 GB VHDX + 检查点空间膨胀 | 低 | 升级验收期禁检查点；主路径冷备份 |
| 误挂宿主目录/磁盘入 VM | 中 | 0/0/0 安全门 + 所有配置命令 AI 预审后交你执行 |
| 评估版 90 天到期 | 低 | 测试周期足够；记录安装日期；到期删 VM |

---

## 12. 阶段 2.1 执行回执（2026-10-24，用户有条件授权；AI 执行下载与验证，未运行任何安装程序）

**下载前条件确认结果**（对用户七项要求的逐条回应）：

| # | 用户条件 | 确认结果 |
|---|---|---|
| 1 | 官方来源/版本/语言/架构/许可 | ✅ 评估中心 Win11 企业版 **26H2 build 26300.9457.260913-1737**，简体中文，x64，90 天评估免密钥 |
| 2 | 0 网卡完成初始化+本地账户 | ⚠️ 可行但非镜像保证——26H2 OOBE 强制联网+MSA；已备四级路径（见 6.3），首选 autounattend.xml；未解决问题见下 |
| 3 | 不把 bypassnro 当固定步骤 | ✅ **该脚本在当前构建已被微软移除**（26200.5516/26120.3656+ 起），方案已彻底弃用，改 ms-cxh:localonly / 手动注册表 / 应答文件 / 审核模式 |
| 4 | 微软支持方案与边界 | ✅ 应答文件（无人参与安装，微软文档化）+ 审核模式；边界已注明（第二 DVD 检索需安装时验证、oscdimg 注入需 ADK 另册授权） |
| 5 | WebView2 官方 Standalone x64 | ✅ 已核实并下载（非引导器） |
| 6 | URL/文件名/签名/校验方法 | ✅ ISO＝官方 fwlink→微软 CDN + KB 5130867 官方 SHA-256 比对；EXE＝官方 fwlink→微软 CDN + Authenticode 验签 |
| 7 | 来源不明即停 | ✅ 来源全部官方，无需启用第三方镜像 |

**已获取并验证的文件**（均存 `D:\HyperV-QH-Test\Media\`）：

| 文件 | 大小 | 校验 | 结果 |
|---|---|---|---|
| `26300.9457.260913-1737.26h2_ge_release_svc_refresh_CLIENTENTERPRISEEVAL_OEMRET_x64FRE_zh-cn.iso` | 8,548,628,480 B（与 CDN Content-Length 一致） | SHA-256 `b37a06d5…90e667a84` **= KB 5130867 官方 ZH-CN 值** | ✅ 通过 |
| `MicrosoftEdgeWebView2RuntimeInstallerX64.exe` | 214,823,632 B（与 CDN Content-Length 一致） | SHA-256 `9b0142e2…4af3df3191`；Authenticode **Valid**（CN=Microsoft Corporation，颁发者 Microsoft Code Signing PCA 2024） | ✅ 通过 |

来源链：`go.microsoft.com/fwlink`（微软官方链接服务）→ `software-static.download.prss.microsoft.com`（ISO）/ `msedge.sf.dl.delivery.mp.microsoft.com`（EXE）。

**未运行**：两个文件均未执行/未安装。注册表单与评估许可条款按约定由你本人操作（ISO 文件直链无需登录即可下载；注册仅影响微软评估跟踪，不阻断本测试）。

**离线安装尚未解决的问题**（安装时才能定论，均已备回退）：
1. 26H2 评估镜像 OOBE 的确切页面流（autounattend.xml 能否被第二虚拟 DVD 检索到）；
2. 25H2 系已知「跳过网络后首次登录转圈」问题在 26H2 是否存在（缓解：禁用首次登录动画或强制重启一次）；
3. 若 A–D 路径全败 → 停止报告，不自行切换第三方镜像。

**阶段 1 证据归档**：固件截图已存 `D:\HyperV-QH-Test\Evidence\phase1\fitwise-091-smoke-firmware-20261024.png`（SHA-256 `03c3389d…9feacb9`）。

## 13. 证据留存约定（2026-10-24 更新）

- 证据根目录：`D:\HyperV-QH-Test\Evidence\`（phase1/、phase2/…）；
- 阶段 1 固件截图**已归档**：`Evidence\phase1\fitwise-091-smoke-firmware-20261024.png`（SHA-256 `03c3389dfa30ea60cee7355a008929202ff997905ed4968a5f346749b9feacb9`，已写入 VM 评估报告第 8.2 节）；
- 每阶段归档：控制台输出/transcript 日志、截图、导出 JSON、SHA-256 清单；
- 清理 VM 前确认证据已归档（清理不删 Evidence 目录，其去留另册授权）。
