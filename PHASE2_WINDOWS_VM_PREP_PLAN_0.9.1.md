# 轻衡 0.9.1｜阶段 2：Windows 虚拟机环境准备方案

日期：2026-10-24｜状态：**阶段 2.1 已完成；阶段 2.2 三个脚本与应答文件已按 2026-10-24 审核意见修订为 rev.3，未执行、待重新审核后单独批准实际创建**（用户重新审核并单独授权前，不创建/启动/安装/清理任何 VM 或文件）；2.3 安装 Windows、轻衡 MSI 均未批准；不访问真实数据库。前置事实：Hyper-V 阶段 1 冒烟**已通过**（回执见 `VM_ACCEPTANCE_FEASIBILITY_0.9.1.md` 第 8.1/8.2 节）。

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
| 磁盘峰值 | 媒体 8.55+0.21 GB + VHDX 实占 25–35 GB + 场景克隆 2×≈35 GB + 检查点（不作主路径）≈ 114–150 GB | D: 928.5 GB 充足；创建脚本预检门：D: 可用 ≥100 GB（明细见第 14.4 节） |
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

## 5. 创建命令序列（阶段 2.2 交付，2026-10-24 更新）

**已交付为可执行脚本**：`%TEMP%\fitwise-hyperv-phase2b-create.ps1` **rev.3**（管理员 PowerShell 5.1 运行）。结构（含写入范围标注）：

| 阶段 | 内容 | 写入属性 |
|---|---|---|
| Phase 0 | 只读预检：管理员/模块/VM 不存在/路径空闲/冒烟 VM 原状/交换机指纹/D: ≥100 GB/两个媒体文件尺寸/宿主机证书存储基线（只读） | **只读** |
| Phase 0W | 建 `Evidence\phase2` 目录 + 启动 transcript | **写**（仅测试树内） |
| Phase 1 | `New-VM`（Gen2 + 80GB 动态 VHDX）+ 记录 **VM 唯一 Id** + 写 `phase2b-creation-record.json` | **写** |
| Phase 2 | 严格移除默认网卡（恰好一块、Gen2+Off、SwitchName 为空、无循环） | **写**（单条变更命令） |
| Phase 3 | Key Protector + vTPM + 证书存储前后清单与 delta | **写**（+ 只读核对） |
| Phase 4 | Secure Boot On / MicrosoftWindows | **写** |
| Phase 5 | 动态内存 4/1/8 GB + 4 vCPU | **写** |
| Phase 6 | 挂 ISO 为只读 DVD + 设首启 **并按设备身份验证** | **写**（+ 只读验证） |
| Phase 7 | 18 项只读汇总门（含 VM 唯一 Id、启动序设备身份、交换机指纹、冒烟 VM、证书可读性） | **只读** |
| Phase 8 | 配置快照 txt + 定稿 creation-record.json | **写** |

每阶段后设验证门，任一失败即 `[FAIL]` 退出码 1、不自动清理/重建、不启动 VM、不做提权绕过。相对上一版（rev.2）的修订点（2026-10-24 审核意见）：

| # | rev.3 修订 | 对应审核要求 |
|---|---|---|
| 1 | 网卡移除改为**严格计数门**：`Count -ne 1` 即停（0 块或 >1 块都停）；`SwitchName` 非空即停；**完全取消 foreach 循环与批量删除** | §2.1 恰好一块 / 不允许循环删除 |
| 2 | 网卡移除前重读 VM，**Id 必须等于 Phase 1 记录的 Id**，并复核 Gen2 + Off | §2.1 对象必须是刚创建的 VM；§2.3 记录唯一 ID |
| 3 | 首启设备改用 `Get-BootIdentity`：经 `BootOrder[0].Device` 取真实设备对象，校验①有 Device 属性②类型为 DvdDrive③媒体路径逐字等于 ISO④控制器身份与承载该 ISO 的 DVD 一致；**任一信号缺失即返回 ok=false 并停止，绝不伪造 PASS**，同时把 BootOrder[0] 原始模型 dump 出来供报告 | §2.2 不得依赖属性假设、不得伪造 PASS |
| 4 | 新增 creation-record.json（VM Id/Gen/配置路径/VHDX/ISO/WebView2/交换机指纹/证书前后/启动序验证结果），供 verify 与 cleanup 作为**可信身份来源** | §2.3 / §4.3 |
| 5 | 头部标注 **WRITE-PHASE MAP**，把 Evidence 目录、transcript、快照、creation-record 明确标为写入操作，不再混称「只读预检」 | §2.3 |
| 6 | 增加宿主机证书存储**只读**前后清单与 delta（thumbprint/subject/有效期/HasPrivateKey 标志），明确不读不导出私钥、不删证书、不改宿主机 TPM/BitLocker | §3 |
| 7 | 失败路径统一为「打印实际值 + 停止 + 报告」，无自动修复、无自动重试、无自动清理重建 | §2.3 / §5 |

人工分步执行时的等价命令（**已不再是推荐路径**：手敲单条命令无法复现 rev.3 的计数门与设备身份验证，仅供理解命令语义；**推荐直接用交付脚本**）：

```powershell
# 1) 创建 VM + 动态 VHDX（不加 -Force）
New-VM -Name "Fitwise-091-Test" -Generation 2 -MemoryStartupBytes 4GB `
  -NewVHDPath "D:\HyperV-QH-Test\Fitwise-091-Test\Virtual Hard Disks\Fitwise-091-Test.vhdx" `
  -NewVHDSizeBytes 80GB -Path "D:\HyperV-QH-Test\Fitwise-091-Test"

# 2) 移除 New-VM 默认附带的网卡（rev.3 严格门：必须恰好 1 块且未连交换机；0 块或多块即停，
#    禁止 Where-Object 批量删除）
$n = @(Get-VMNetworkAdapter -VMName "Fitwise-091-Test")
if ($n.Count -ne 1) { throw ("expected exactly 1 NIC, found " + $n.Count + " - stop") }
if ($n[0].SwitchName) { throw "the NIC is connected to a switch - stop" }
$n[0] | Remove-VMNetworkAdapter
@(Get-VMNetworkAdapter -VMName "Fitwise-091-Test").Count      # 必须为 0

# 3) Win11 Gen2 要求：先 Key Protector 后 vTPM（VM 必须 Off）
Set-VMKeyProtector -VMName "Fitwise-091-Test" -NewLocalKeyProtector
Enable-VMTPM -VMName "Fitwise-091-Test"

# 4) Secure Boot
Set-VMFirmware -VMName "Fitwise-091-Test" -EnableSecureBoot On -SecureBootTemplate "MicrosoftWindows"

# 5) 内存/CPU
Set-VMMemory -VMName "Fitwise-091-Test" -DynamicMemoryEnabled $true -StartupBytes 4GB -MinimumBytes 1GB -MaximumBytes 8GB
Set-VMProcessor -VMName "Fitwise-091-Test" -Count 4

# 6) 挂 ISO 并设首选启动设备
Add-VMDvdDrive -VMName "Fitwise-091-Test" -Path "D:\HyperV-QH-Test\Media\26300.9457.260913-1737.26h2_ge_release_svc_refresh_CLIENTENTERPRISEEVAL_OEMRET_x64FRE_zh-cn.iso"
Set-VMFirmware -VMName "Fitwise-091-Test" -FirstBootDevice (Get-VMDvdDrive -VMName "Fitwise-091-Test")

# 7) 验证门（本 VM 预期 1 VHDX + 1 DVD、0 网卡、Gen2、Off；与冒烟 VM 的 0/0/0 门不同）
#    首启设备必须按设备身份核对（BootOrder[0].Device 为 DvdDrive 且 .Path 逐字等于 ISO），
#    不得直接读 BootOrder 条目自身的 Path 属性当结论。
```

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

**分级路径（按优先级，全部只用微软文档化手段，不用未知来源脚本；2026-10-24 审核后重新分级）**：

| 级 | 方法 | 依据与边界 | 授权状态 |
|---|---|---|---|
| **A（微软支持，主路径）** | **autounattend.xml 应答文件**：置于**第二块虚拟 DVD 根目录**。内容：`HideOnlineAccountScreens=1`、`HideWirelessSetupInOOBE=1`（`Microsoft-Windows-Shell-Setup`）+ `UserAccounts/LocalAccounts` 建**专用测试账户（非空密码）** + 跳过 EULA/隐私页 | 微软文档化部署技术（无人参与应答文件）；**自动发现有官方依据：MSDN dn938367 隐式应答文件搜索顺序路径⑤「可移动只读介质根目录（按盘符序，须名 Autounattend.xml）」——虚拟 DVD 正属此类（详见 14.7）**；边界：文档依据 ≠ 本镜像实测，安装时验证；若不被检索，改放安装 ISO 的 `\Sources`（路径⑥）需 oscdimg 重刻（ADK，另册授权） | **预批准的唯一路径**（仍须 2.3 单独授权后才执行） |
| **B（回退 1，需单独授权）** | OOBE 网络页 **Shift+F10** → `start ms-cxh:localonly` → 弹出本地账户创建对话框，无需重启 | 24H2/25H2/26H2 上多个微软 Q&A/技术记录确认可用 | **需单独授权**：A 失败后先停止报告，由你决定是否批准 B |
| **C（回退 2，需单独授权）** | Shift+F10 → `reg add HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\OOBE /v BypassNRO /t REG_DWORD /d 1 /f` + `reg add HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System /v EnableFirstLogonAnimation /t REG_DWORD /d 0 /f` + `shutdown /r /t 0` → 重启后出现「我没有 Internet」 | 即被移除脚本的两条命令的手动等价（脚本内容本身公开展示过）；微软 Learn 中文问答同路径 | **需单独授权**：属注册表改写，**不得自动执行**；即使 B 也失败，也必须先停止报告再等你批准 |
| **D（末选，需单独授权）** | OOBE 首屏 **Ctrl+Shift+F3** 进入审核模式（内置 Administrator） | 微软文档化（Audit Mode）；但账户模型变为内置管理员，与测试账户语义不同，仅当前面全部失败时用 | **需单独授权** |

**停止纪律（2026-10-24 审核新增，硬约束）**：安装时若 OOBE 实际流程与本方案预期不同（页面顺序变化、应答文件未被检索、出现未预期的强制联网页、本地账户创建失败等），**一律停止并报告实际现象**，**不得**自行执行 C 的注册表命令、不得改走未批准的替代路径、不得切换到第三方镜像或第三方脚本。

**明确不用**：`bypassnro.cmd`（本构建已移除）、第三方 ISO 修改工具（如 Rufus 改写镜像）、任何来源不明的账户绕过脚本。若 A 失败且 B/C/D 均未获单独授权 → 停留在「已停止、待授权」状态。

**路径 A 应答文件模板（rev.3，含密码占位符）**（独立副本：`PHASE2_AUTOUNATTEND_TEMPLATE_0.9.1.xml`，与下述一致；2026-10-24 已通过 Python XML 解析校验，审核结论见 14.6；获批后才落盘到第二块虚拟 DVD 根目录；最终校验建议用 ADK 的 Windows SIM 打开确认）：

```xml
<?xml version="1.0" encoding="utf-8"?>
<unattend xmlns="urn:schemas-microsoft-com:unattend"
          xmlns:wcm="http://schemas.microsoft.com/WMIConfig/2002/State">
  <settings pass="oobeSystem">
    <component name="Microsoft-Windows-Shell-Setup"
               processorArchitecture="amd64" language="neutral"
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
            <Password>
              <Value>__FITWISE_TEST_PASSWORD__</Value>
              <PlainText>true</PlainText>
            </Password>
            <Name>fitwistest</Name>
            <Group>Administrators</Group>
          </LocalAccount>
        </LocalAccounts>
      </UserAccounts>
    </component>
  </settings>
</unattend>
```

**模板修订说明**：
① **rev.2（2026-10-24）**：移除 component 上的 `scope="oobeSystem"` 属性——非必需，其合法性在无 SIM 环境下无法 100% 确认，按保守原则移除。
② **rev.3（2026-10-24 审核后）**：**撤销**上一版「本地账户不设密码（空白密码）」的做法，改为**专用测试账户 + 非空密码**：新增 `Password` 元素（`Value` 为占位符 `__FITWISE_TEST_PASSWORD__`，`PlainText=true`），并按 SIM 元素顺序约定把 `Password` 放在 `Name`/`Group` 之前。占位符机制、密码传递与删除、日志脱敏要求见新增 §6.6。
③ 其余字段名（`Microsoft-Windows-Shell-Setup` / `HideOnlineAccountScreens` / `HideWirelessSetupInOOBE` / `HideOEMRegistrationScreen` / `ProtectYourPC` / `UserAccounts/LocalAccounts/LocalAccount@wcm:action` / `Password/PlainText`）均为微软无人参与文档标准元素。

### 6.5 第二块虚拟 DVD 的制作方式（阶段 2.3 步骤，未授权；2026-10-24 补充）

`Add-VMDvdDrive` 只接受 `.iso` 文件，因此需要把 `autounattend.xml` 做成一个小 ISO：

| 方案 | 说明 | 采用 |
|---|---|---|
| **IMAPI2FS COM（推荐）** | 微软「Windows 映像掌握 API v2」（`IMAPI2FS.MsftISOFSManager`，即资源管理器「刻录到光盘」同源 API，Win11 宿主机自带）。用 PowerShell COM 调用即可离线生成只含 autounattend.xml 的 ISO，**无需 ADK、无需联网、无需第三方工具** | ✅ |
| oscdimg（ADK） | 微软 ADK「部署工具」自带，官方 ISO 制作工具；需另装 ADK（体量大） | 备选，需单独授权安装 |

脚本（2.3 获批后执行，先建 `D:\HyperV-QH-Test\Media\autounattend-src\autounattend.xml` 再生成 `D:\HyperV-QH-Test\Media\fitwise-autounattend.iso`）：

```powershell
$src = "D:\HyperV-QH-Test\Media\autounattend-src"
$iso = "D:\HyperV-QH-Test\Media\fitwise-autounattend.iso"
$fsi = New-Object -COM IMAPI2FS.MsftFileSystemImage
$fsi.FileSystemsToCreate = 7            # ISO9660 + Joliet + UDF
$fsi.VolumeName = "FITWISE_UNATTEND"
$fsi.Root.AddTree($src, $false)
$res = $fsi.CreateResultImage()
$stream = $res.ImageStream
[void]$stream.SaveToFile($iso, 0)       # 0 = overwrite
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

### 6.6 本地测试账户的密码管理（2026-10-24 审核新增，阶段 2.3 执行前必读）

| # | 规则 | 说明 |
|---|---|---|
| 1 | **专用一次性账户** | 账户 `fitwistest` 只存在于本隔离测试 VM 内，**不复用到宿主机或任何其他系统**；VM 删除即销毁。 |
| 2 | **必须非空密码** | 撤销「空白密码」做法。空白密码在 OOBE/远程登录/组策略上行为不确定，且不符合最小安全要求。 |
| 3 | **密码由你本人设定** | 密码不经过 AI、不由 AI 生成或记录；任何人（包括本对话）都不应知道该密码。 |
| 4 | **仓库内只有占位符** | 版本库中的 `PHASE2_AUTOUNATTEND_TEMPLATE_0.9.1.xml` 只含 `__FITWISE_TEST_PASSWORD__`，**真实密码永不进入 Git**（提交前可用 `git grep` 自查占位符以外的可疑串）。 |
| 5 | **工作副本 + 本地替换** | 2.3 准备阶段在 `D:\HyperV-QH-Test\Media\autounattend-src\autounattend.xml` 生成工作副本，用 XmlDocument 写入密码（自动处理 XML 转义，避免 `& < >` 破坏文件）；命令见下表下方代码块。 |
| 6 | **用后删除工作副本** | `fitwise-autounattend.iso` 生成后立即删除 `autounattend-src\autounattend.xml`（源码目录可保留空目录）。**如实披露**：只读 DVD 内的 ISO 仍含该密码，这是应答文件技术的固有事实；微软官方明示 `PlainText=false`（Base64）**不提供加密或其他安全优势**，因此防护来自「一次性专用密码 + 全离线隔离 VM + 验收后销毁 VM」，而非编码。 |
| 7 | **日志/报告/对话脱敏** | 三个交付脚本**完全不接触**应答文件与密码（`grep` 自查：脚本内无 `autounattend` 写入、无 `Password` 变量）；任何 transcript/验收报告不得粘贴工作副本内容；如需记录准备过程，只记录命令与占位符。 |
| 8 | **PowerShell Direct 凭据** | 来宾凭据用 `Get-Credential` **交互输入**（见 §6.4），不写入脚本文件、不写入 transcript、不存 `cmdkey`。 |
| 9 | **怀疑泄露即重建** | 隔离环境下就地改密收益低：直接按 §9 清理脚本删 VM 重建更干净。**不做**就地改密。 |
| 10 | **不采用 AutoLogon** | 不用 `AutoLogon`（需把密码写入注册表且配合 `LogonCount`，属额外风险面），本方案不需要自动登录。 |

工作副本生成命令（第 5 条的落地脚本，2.3 阶段执行；密码交互输入、不落盘、不进历史）：

```powershell
$tpl = "C:\Users\21904\Projects\ai-fitness-platform\PHASE2_AUTOUNATTEND_TEMPLATE_0.9.1.xml"
$src = "D:\HyperV-QH-Test\Media\autounattend-src\autounattend.xml"
New-Item -ItemType Directory -Path (Split-Path $src) -Force | Out-Null
$sec   = Read-Host "test account password (interactive, not logged)" -AsSecureString
$plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
           [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
[xml]$doc = Get-Content -LiteralPath $tpl -Raw
$ns = New-Object System.Xml.XmlNamespaceManager($doc.NameTable)
$ns.AddNamespace("u", "urn:schemas-microsoft-com:unattend")
$doc.SelectSingleNode("//u:LocalAccount/u:Password/u:Value", $ns).InnerText = $plain
$doc.Save($src)
Remove-Variable plain, sec
Select-String -LiteralPath $src -Pattern "__FITWISE_TEST_PASSWORD__"   # 必须无输出
```

注：本环境**未安装 ADK/Windows SIM**，无法做 SIM 级结构校验；已做的是 Python XML 解析 + 元素/属性/顺序核对（见 14.6），如实标注该缺口。

---

## 7. Windows 11 Gen2 要求与最小权限配置

| 要求 | 满足方式 | 权限性质 |
|---|---|---|
| TPM 2.0 | `Set-VMKeyProtector -NewLocalKeyProtector` → `Enable-VMTPM`（vTPM，**不需要宿主机 TPM**；宿主 TPM 状态不阻断） | 按 VM 设置；**如实披露：Key Protector 命令会在宿主机本地计算机证书存储自动生成 "Shielded VM Local Certificates"（UntrustedGuardian，两张自签名证书）——这是独立宿主机启用 vTPM 的微软既定行为，非脚本额外动作（见 14.2）** |
| Secure Boot | `Set-VMFirmware -EnableSecureBoot On -SecureBootTemplate "MicrosoftWindows"`（Gen2 默认即开，显式确认） | 按 VM 设置 |
| UEFI 固件 | Gen2 原生 | 创建即定 |
| 内存 ≥4 GB | 动态 4/1/8 GB | 按 VM 设置 |
| 存储 ≥64 GB | 80 GB 动态 VHDX | 新建文件 |
| CPU ≥2 核 | 4 vCPU | 按 VM 设置 |

**宿主机改动的准确表述（2026-10-24 审核修正，不再声称「零改动」）**：

- **明确不做**：不建/不改交换机（`Default Switch` 不连接、不修改、不删除）、不改物理网络/防火墙/驱动/组策略、不改增强会话主机设置、不启用/禁用任何 Windows 功能（阶段 1 已确认全部 Enabled）。
- **实际会产生的宿主机侧产物（如实披露）**：① `D:\HyperV-QH-Test` 下的 VM 配置文件与 VHDX；② `Evidence\phase2` 下的 transcript/快照/creation-record/清理报告；③ **vTPM 启用时 Hyper-V 自动在 `Cert:\LocalMachine\My` 生成 `Shielded VM Local Certificates`（UntrustedGuardian，两张自签名证书）**——这是微软 vTPM 的既定行为（GUI 与 PowerShell 路径都会产生），不是脚本的额外动作；vTPM 本身**不需要宿主机 TPM**，也不读取、不导出、不删除这些证书的私钥（脚本只读 subject/thumbprint/有效期/HasPrivateKey 标志，并在 creation-record 中记录前后清单与 delta）。
- 来宾内可选优化：`powercfg /change standby-timeout-ac 0`（防休眠中断测试）。默认不同步宿主时间以外的任何宿主资源。

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

## 9. 完整回滚与清理方式（2026-10-24 审核后收紧）

**阶段 2/3/4 的宿主机改动＝VM 相关文件 + Evidence + vTPM 自动生成的两张宿主机证书**（无交换机、无功能、无网络/防火墙/驱动/组策略变更）。回滚脚本 `fitwise-hyperv-phase2b-cleanup.ps1` **rev.3** 的行为边界：

| 项 | rev.3 行为 |
|---|---|
| 关机 | **绝不自动强制关机**。脚本内**不存在** `Stop-VM`/`Restart-VM` 命令；VM 非 Off 时直接停止并报告，由你自行决定是否关机。 |
| 身份校验 | 必须存在 `Evidence\phase2\phase2b-creation-record.json`（创建时写入的**可信记录**），且当前 VM 的**唯一 Id**、名称、Generation、配置路径、VHDX 路径必须与记录一致；记录缺失或不一致 → 停，不删。 |
| 设备校验 | 0 或 1 块 VHDX（路径＝授权路径且＝记录路径）；所有 DVD 必须指向授权媒体（安装 ISO / autounattend ISO）；**0 网卡**；**无检查点、无 AVHDX 残留**；否则停。 |
| 递归删除前置 | 先枚举 VM 目录**完整文件清单**并过白名单（`Virtual Hard Disks\Fitwise-091-Test.vhdx`、`Virtual Machines\<vmId>*`），出现任何未知文件/未知子目录/额外 VHDX/日志/备份 → **一个字节都不删**，直接停。 |
| 删除范围 | 仅三样：VM 定义（`Remove-VM`）、VHDX 文件（显式路径）、VM 目录（白名单通过后递归）。每条删除都做 `Resolve` 后逐字相等校验，**无通配符**。 |
| 永不删除 | 安装 ISO、WebView2 安装包、autounattend 工作副本/ISO、`Evidence` 目录（含 creation-record 与报告）、`Fitwise-091-Smoke`、`Default Switch`、**宿主机证书**、真实轻衡数据库、父目录 `D:\HyperV-QH-Test`（rev.1/rev.2 的 `-IncludeMedia` 参数**已整体移除**，脚本接受 0 个参数）。 |
| 事后 | 只读复核（VM 消失/VHDX 消失/目录消失/媒体与 Evidence 保留/交换机仍唯一/冒烟 VM 仍 Off/证书数量只读核对/D: 空间回收）+ 把报告写入 `Evidence\phase2\phase2b-cleanup-report-<时间戳>.txt`。 |

**媒体文件（8.55 GB ISO + 0.21 GB EXE）的去留**：本脚本不删。若确需回收空间，属**单独的删除动作**，需你另行明确授权（并建议先归档验收证据）。

**冒烟 VM `Fitwise-091-Smoke`**：保留至阶段 1 证据链完整归档后，另册授权清理。

**阶段 2.3 之后的重置**：按 8.0bis 用基线 VHDX 整文件克隆场景盘替换（关机→移除当前盘→挂下一场景盘，显式路径），**不用检查点作主路径**。

---

## 10. 阶段 2 授权表（待批准）

| 步骤 | 内容 | 授权点 | 停止点 |
|---|---|---|---|
| 2.1 | 下载 Win11 企业版评估 ISO（x64，简体中文）+ WebView2 独立安装包，存 `D:\HyperV-QH-Test\Media` | 需授权：宿主下载（你执行或单独授权 AI） | 下载完成、SHA-256 记录后即停 |
| | **✅ 已完成（2026-10-24，见第 12 节：两文件均已官方源下载+校验通过，未运行）** | | |
| 2.2 | 按第 5 节创建 `Fitwise-091-Test` 并配置（TPM/SB/内存/CPU/ISO/启动顺序） | **三脚本与应答文件已按 2026-10-24 审核意见修订为 rev.3（见第 14 节）；实际创建须在重新审核后单独批准** | 创建并配置完成、Phase 7 全门通过即停（不启动 VM） |
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

---

## 14. 阶段 2.2 交付清单（2026-10-24：rev.3 已按审核意见修订，**未执行创建**，待重新审核 + 单独批准）

### 14.1 交付文件（rev.3，均在 `%TEMP%`，管理员 Windows PowerShell 5.1 执行）

| 文件 | 用途 | 性质 |
|---|---|---|
| `fitwise-hyperv-phase2b-create.ps1` | rev.3：Phase 0 只读预检 → 0W 建证据目录/transcript → 1 创建 VM+VHDX+记录 VM 唯一 Id → 2 严格移除网卡 → 3 Key Protector+vTPM+证书前后 delta → 4 Secure Boot → 5 内存/CPU → 6 挂 ISO+按设备身份验证首启 → 7 只读汇总门 → 8 快照+记录定稿 | 变更类（实际创建需再次授权） |
| `fitwise-hyperv-phase2b-verify.ps1` | rev.3：只读全量复核（含 VM 唯一 Id 与 creation-record 比对、BootOrder 设备身份 dump、证书存储只读清单、AVHDX/检查点检查）；`-HashMedia` 可选重算两个媒体 SHA-256 并与已知值比对。**不写任何文件** | 只读 |
| `fitwise-hyperv-phase2b-cleanup.ps1` | rev.3：受控回滚。**无参数**（`-IncludeMedia` 已删除）、**无任何关机命令**、创建记录 Id 校验、设备/检查点校验、文件清单白名单、显式路径删除、删后只读复核+报告 | 变更类（仅单独授权后，本轮不得执行） |

脚本自检结果（2026-10-24 rev.3，AI 侧只读核实）：PowerShell Parser 三脚本**均 0 错误**（create 34,786 B / verify 15,702 B / cleanup 17,209 B）；**纯 ASCII（0 个非 ASCII 字节、无 BOM）**；命令行级扫描：create 含 `New-VM`×1、`Set-VMKeyProtector`×1、`Enable-VMTPM`×1、`Set-VMFirmware`×2、`Set-VMMemory`×1、`Set-VMProcessor`×1、`Add-VMDvdDrive`×1、`$nics[0] | Remove-VMNetworkAdapter`×1，**0 处 `Start-VM`/`Stop-VM`/`Remove-VM`/`Remove-Item`/`-Force` on New-VM**；verify **0 处变更类命令**；cleanup 含 `Remove-VM`×1、`Remove-Item`×2（VHDX 显式 + VM 目录白名单后递归），**0 处 `Stop-VM`/`Restart-VM`**；三脚本**0 处通配符删除**（`Remove-Item ... *` 计数 0）；cleanup **无 `param` 块**（不接受任何开关）。

### 14.2 vTPM 与 Secure Boot 配置依据

- **顺序**（已核实命令语法与输出属性）：`Set-VMKeyProtector -NewLocalKeyProtector` → `Enable-VMTPM` → `Set-VMFirmware -EnableSecureBoot On -SecureBootTemplate "MicrosoftWindows"`；三者均要求 VM 处于 **Off**（脚本每步前检查 `State`）。
- **依据**：PowerShell 路径启用 vTPM 前必须先有 Key Protector（Hyper-V 管理器 GUI 会自动创建，PowerShell 不会，故必须显式两条命令）；Gen2 VM 默认 Secure Boot 即 On/`MicrosoftWindows`，显式设置作确认与留痕。
- **宿主机侧产物（如实披露，rev.3 增补核对方式）**：`Set-VMKeyProtector -NewLocalKeyProtector` 会在宿主机本地计算机证书存储 `Cert:\LocalMachine\My` 自动生成 `Shielded VM Local Certificates`（UntrustedGuardian，两张自签名证书）。这是独立宿主机上启用 vTPM 的微软既定行为，不是脚本的额外动作；vTPM 本身**不需要宿主机 TPM**。rev.3 的做法：**只读**枚举 subject/thumbprint/有效期/`HasPrivateKey` 标志，Phase 0 取基线、Phase 3 取 after 并算 delta，写入 creation-record；**不读取、不导出私钥；不删除宿主机证书；不改宿主机 TPM/BitLocker/其他 VM 保护配置**；任何额外证书操作需单独授权。
- **验证命令（只读）**：`Get-VMSecurity -VMName "Fitwise-091-Test" | Select TpmEnabled`（应 True）；`Get-VMFirmware -VMName "Fitwise-091-Test" | Select SecureBoot, SecureBootTemplate`（应 On / MicrosoftWindows）；`Get-VMKeyProtector -VMName ...`（只验证存在，不打印字节）。
- **已知边界**：有资料记载「vTPM 启用后更换 Secure Boot 模板」在部分场景受限——本方案为先建全新 VM、一次性按上序配置，不涉及既有 TPM 状态的模板更换；若第 4 步报错，按异常纪律停止报告，不自行改序重试。

### 14.3 零网卡 / 零交换机连接验证方法

- 创建中：Phase 2 移除默认网卡后立即门控 `NIC=0`；Phase 7 汇总复核。
- 随时可复核（只读）：
  - `@(Get-VMNetworkAdapter -VMName "Fitwise-091-Test").Count` → **0**；
  - `Get-VMSwitch` → **仅 `Default Switch`（Internal）**，且 `Name|SwitchType|Id` 指纹与创建前一致；
  - `Get-VM | ForEach-Object { Get-VMNetworkAdapter -VMName $_.Name } | Where-Object { $_.SwitchName }` → **空**（宿主机无任何 VM 连接交换机）。
- 注意口径差异：本 VM 预期 **1 VHDX + 1 DVD、0 网卡**（与冒烟 VM 的 0/0/0 门不同，验证脚本已按此编写）。

### 14.4 存储开销（D: 创建前可用 928.5 GB）

| 项 | 估算 |
|---|---|
| 媒体（已在 `D:\HyperV-QH-Test\Media`） | ISO 8.55 GB + WebView2 0.21 GB = **8.76 GB** |
| 80 GB 动态 VHDX | 创建时文件约 4 MB 量级；装 Windows+WebView2+应用后实占 **25–35 GB** |
| 阶段 3/4 场景克隆（8.0bis 整文件复制 ×2） | ≈ 2×35 GB = **70 GB** |
| 检查点（不作主路径，仅临时命名快照） | 视使用另计 |
| **合计峰值** | **≈ 105–115 GB**，D: 余量充裕；创建脚本预检门：D: 可用 **≥100 GB** 才继续 |

### 14.5 创建后清理与恢复方案

- **正常回滚（2.2 状态）**：`fitwise-hyperv-phase2b-cleanup.ps1` **rev.3** → 管理员守卫 → 名称精确 → **creation-record 读取成功且 VM 唯一 Id/名称/Generation/配置路径/VHDX 路径全部一致** → Gen2 → **State 必须 Off（非 Off 即停，无任何关机命令）** → 0/1 块 VHDX 且路径一致 → DVD 全部指向授权媒体 → 0 网卡 → 无检查点/无 AVHDX → Evidence 不重叠 → **文件清单白名单通过** → `Remove-VM` → 显式路径删 VHDX → 递归删 VM 目录 → 只读复核（VM 消失、VHDX/目录消失、媒体保留、Evidence 保留、Default Switch 唯一、冒烟 VM 仍 Off、证书数量只读核对、D: 空间回收）→ 报告写入 Evidence。**不删父目录、不删媒体、不删证书。**
- **安装后（2.3+）重置到干净状态**：按 8.0bis 用基线 VHDX 的整文件克隆场景盘替换（关机→移除当前盘→挂下一场景盘，显式路径），**不用检查点作主路径**。
- **宿主机全量回滚可证性**：全程宿主机功能/网络/防火墙/驱动/组策略/增强会话零改动；唯一主机侧 artifacts＝VM 相关文件 + vTPM 自动生成的两张本地证书（见 14.2）；`Get-VMSwitch` 前后一致可证。

### 14.6 autounattend.xml 模板审核结果（对应用户第 3 节四项要求）

| 审核项 | 结论 |
|---|---|
| 语法 | ✅ Python XML 解析通过；结构＝`settings pass="oobeSystem"` + `component Microsoft-Windows-Shell-Setup`（`processorArchitecture="amd64"`、`language="neutral"`、`publicKeyToken="31bf3856ad364e35"`）+ `OOBE` 五个开关 + `UserAccounts/LocalAccounts` |
| 组件与配置阶段 | ✅ 仅一个 pass（oobeSystem）；组件为微软标准 Shell-Setup；已移除存疑的 `scope` 属性（见 6.3 修订说明） |
| 本地账户 | ✅ `fitwistest`（专用一次性测试账户），`Administrators` 组，`wcm:action="add"`；**rev.3 起为非空密码**（占位符 `__FITWISE_TEST_PASSWORD__`，`PlainText=true`），空白密码做法已撤销 |
| 密码元素合法性 | ✅ `Microsoft-Windows-Shell-Setup \| UserAccounts \| LocalAccounts \| LocalAccount \| Password \| PlainText` 为微软无人参与文档标准元素（适用 pass：`auditSystem`/`oobeSystem`）。`PlainText=true`＝按字面读取（文档默认）；`false`＝Base64(UTF-16LE)，官方明示**不提供加密或其他安全优势**。模板按 SIM 顺序约定把 `Password` 置于 `Name`/`Group` 之前（Python 校验实测子元素顺序＝`Password, Name, Group`） |
| 安全设置 | ⚠️ 账户入管理员组是安装 MSI/WebView2 与 PowerShell Direct 管理操作的必需；隔离评估 VM + 合成数据，风险可控；`ProtectYourPC=3`（最小化在线回传，符合 0 网卡离线场景）；密码生命周期见 §6.6 |
| 与 26H2 评估镜像的适配性 | ⚠️ **文档依据存在、镜像实测待做**：组件/阶段/账户模型为微软标准，但 `HideOnlineAccountScreens` 等开关在 26H2 上的实际效果只能安装时验证；若 OOBE 流程与预期不同 → 停止报告（见 §6.3 停止纪律） |
| 最终校验建议 | 有条件时用 ADK 的 Windows SIM 打开确认（本环境无 ADK，未做 SIM 级校验，如实说明） |

独立副本：`PHASE2_AUTOUNATTEND_TEMPLATE_0.9.1.xml`（仓库根目录，与 6.3 内嵌模板一致）。

### 14.7 应答文件自动发现依据（对应用户第 3 节硬性要求「必须说明是否有可靠依据」）

**有官方文档依据。** 微软《Windows 安装程序自动化概述》（MSDN dn938367）公布的隐式应答文件搜索顺序：

1. 注册表 `HKLM\System\Setup\UnattendFile`；
2. `%WINDIR%\Panther\Unattend`；
3. `%WINDIR%\Panther`（缓存）；
4. 可移动**读写**介质根目录（按盘符序，须名 `Autounattend.xml`）；
5. **可移动只读介质根目录（按盘符序，须名 `Autounattend.xml`）** ← 第二块虚拟 DVD 属此类；
6. windowsPE/offlineServicing 阶段：发行包 `\Sources` 目录（＝安装 ISO 内 `\Sources`）。

结论：`autounattend.xml` 置于**第二块虚拟 DVD 根目录**有官方文档依据（路径⑤）；Setup 在 windowsPE 阶段前期执行该搜索，命中后缓存至 `%WINDIR%\Panther` 供 oobeSystem 阶段使用。**仍未实证**：文档依据 ≠ 本镜像实测——安装时观察是否被检索，未命中即按 6.3 转路径 B/C/D；把应答文件改放安装 ISO 的 `\Sources`（路径⑥）需 oscdimg 重刻（ADK，另册授权）。第二块 DVD 的制作方式见 6.5（IMAPI2FS，微软 API、离线、无需 ADK）。

### 14.8 每一步对应的只读复核命令（创建后可逐条运行）

| 阶段 | 只读复核命令 | 期望 |
|---|---|---|
| 预检 | `Get-VM` | 无 `Fitwise-091-Test`；`Fitwise-091-Smoke` 为 Off |
| 预检 | `Get-VMSwitch` | 仅 `Default Switch`（Internal） |
| 创建后 | `Get-VM -Name "Fitwise-091-Test" \| Select Name,Generation,State,ConfigurationLocation` | Gen2 / Off / 配置目录在 `D:\HyperV-QH-Test\Fitwise-091-Test` |
| 创建后 | `Get-VMHardDiskDrive -VMName "Fitwise-091-Test"` | 1 个，路径＝授权的 VHDX 全路径 |
| 网卡 | `@(Get-VMNetworkAdapter -VMName "Fitwise-091-Test").Count` | 0 |
| vTPM | `Get-VMSecurity -VMName "Fitwise-091-Test" \| Select TpmEnabled` | True |
| Secure Boot | `Get-VMFirmware -VMName "Fitwise-091-Test" \| Select SecureBoot,SecureBootTemplate` | On / MicrosoftWindows |
| 内存/CPU | `Get-VMMemory`、`Get-VMProcessor -VMName ... \| Select Count` | 4/1/8 GB 动态；4 |
| 唯一 Id | `(Get-VM -Name "Fitwise-091-Test").Id`（与 `Evidence\phase2\phase2b-creation-record.json` 的 `vmId` 比对） | 一致 |
| DVD/启动 | `Get-VMDvdDrive -VMName "Fitwise-091-Test"` + **设备身份核对**：`$fw=(Get-VMFirmware -VMName "Fitwise-091-Test"); $b=$fw.BootOrder[0]; $b.Device.GetType().FullName; $b.Device.Path; $b.Device.ControllerType; $b.Device.ControllerNumber; $b.Device.ControllerLocation` | 1 个 DVD＝ISO 全路径；首启 `$b.Device` 为 `…DvdDrive` 且 `.Path` 逐字等于 ISO；控制器三元组与该 DVD 一致（**不要**只读 `$b.Path` 当结论） |
| 隔离 | `Get-VM \| % { Get-VMNetworkAdapter -VMName $_.Name } \| ? { $_.SwitchName }` | 空 |
| 汇总 | `fitwise-hyperv-phase2b-verify.ps1`（`-HashMedia` 可选） | 全 PASS |

### 14.9 仍未解决的离线 Windows 初始化问题（2.3 安装时才能定论）

1. 26H2 OOBE 确切页面流，以及 autounattend.xml 能否被第二虚拟 DVD 检索到（有文档依据，待实证）；
2. 25H2 系「跳过网络后首次登录转圈」问题在 26H2 是否存在（缓解：禁用首次登录动画——**但该缓解命令属审核后需单独授权的回退路径 C，不得自动执行**）；
3. 26H2 上 `HideOnlineAccountScreens` 与预置本地账户的组合是否真的跳过 MSA 页（文档依据有，镜像实测无）；
4. 预置**非空密码**账户在 OOBE 后的行为（是否要求首次登录即改密）待观察；
5. 若 A（应答文件）失败 → **停止报告**，B/C/D 各需单独授权后才可尝试；
6. 若全部路径不可行 → 停止并报告，不自行切换第三方镜像（既定边界）。

### 14.10 本轮停止点声明（2026-10-24 rev.3 修订轮）

仅修改/交付脚本、应答文件与文档。**未**创建 VM/VHDX、**未**启动或停止任何 VM、**未**安装 Windows、**未**运行 WebView2/MSI、**未**执行清理脚本、**未**删除任何文件、**未**访问真实数据库、**未**修改宿主机 Hyper-V 功能/驱动/组策略/网络/交换机、**未**触碰 `Default Switch` 与 `Fitwise-091-Smoke`、**未**改动宿主机证书存储（只读读取已在其上下文内说明）、**未**修改轻衡源码、**未**推送 GitHub/建 tag/Release。等待你重新审核三个脚本并**单独批准**实际创建 `Fitwise-091-Test`。

### 14.11 修订回执：密码管理（对应审核 §6）

| 审核要求 | 落实情况 |
|---|---|
| 不默认创建空白密码账户 | ✅ 模板 rev.3 新增 `Password/Value` + `PlainText=true`；空白密码做法在 6.3 修订说明与 14.6 中明确撤销 |
| 专用测试账户 + 非空密码 | ✅ `fitwistest` 定位为一次性专用账户（§6.6 第 1–2 条） |
| 密码不明文进 Git/日志/报告/聊天 | ✅ 仓库只存占位符；真实密码由你本人在工作副本中本地写入；脚本不接触应答文件；§6.6 第 4/7 条 |
| 临时应答文件的保密/传递/删除/脱敏机制 | ✅ §6.6 第 5–7 条：工作副本路径固定、XmlDocument 写入、ISO 生成后删除工作副本、日志只记命令与占位符；并如实披露「只读 DVD 内 ISO 仍含密码」这一技术固有事实 |
| PowerShell Direct 来宾凭据要求 | ✅ §6.6 第 8 条：`Get-Credential` 交互输入，不写入脚本/transcript/cmdkey |
| 组件/配置阶段/账户适配性核查 | ✅ 14.6 增补「密码元素合法性」与「与 26H2 适配性」两行，明确文档依据 vs 镜像实测的差距 |
| 第二 DVD 发现机制及限制 | ✅ 14.7 保留：MSDN dn938367 路径⑤有官方依据，但**不等于本镜像实测**；未命中即停 |
| OOBE 不符预期即停、不自动绕过 | ✅ §6.3 停止纪律：B/C/D 全部改为「需单独授权」，禁止自动执行注册表命令 |

### 14.12 修订回执：启动序验证设计与缺口处理（对应审核 §2.2）

- **原缺陷**：rev.2 直接读 `BootOrder[0].Path` 作为首启设备路径——该属性在 BootOrder 条目上是否存在、语义是否等于媒体路径，并无可靠依据，属「属性假设」误报源。
- **rev.3 设计**：`Get-BootIdentity` 经 `.Device` 取真实设备对象，四道门（有 Device → 类型为 DvdDrive → `.Device.Path` 逐字等于 ISO → 控制器身份与承载该 ISO 的 DVD 一致，含 ControllerType/Number/Location 交叉核对）。
- **缺口处理**：任一信号缺失（无 `Device` 属性、Device 为 null、控制器属性未暴露且无法交叉核对）→ 返回 `Ok=$false` + 明确 reason，脚本**打印 BootOrder[0] 原始对象 dump 并停止**，绝不把「读不到」当「通过」。
- **仍待实测**：本机 Hyper-V 版本的 BootOrder 条目是否暴露 `.Device`（微软 Learn 官方博客明确该属性存在并持有设备对象，但**本机未实测**）。若实测不可用 → 按设计停止，把 dump 报告回来，再决定是否改用其他等价身份链（例如仅以 `Get-VMDvdDrive` 路径 + `Get-VMFirmware` 原始 dump 人工判读）。**当前状态：未实测，不作为已通过项。**

### 14.13 修订回执：宿主机证书副作用（对应审核 §3）

| 审核要求 | 落实情况 |
|---|---|
| 明确证书及作用 | ✅ 14.2 与 §7：`Shielded VM Local Certificates`（UntrustedGuardian，两张自签名证书），是 vTPM 密钥保护器的宿主侧承载，属微软 vTPM 既定行为 |
| 如何只读核对 | ✅ 脚本内 `Get-ChildItem Cert:\LocalMachine\My` 只读枚举 subject/thumbprint/有效期/`HasPrivateKey` 标志；verify 脚本同时列出 guardian 相关条目 |
| 记录前后变化 | ✅ create 脚本 Phase 0 存基线、Phase 3 存 after 并算 delta，全部写入 `phase2b-creation-record.json` |
| 不读不导出私钥 | ✅ 代码中无 `Export-*`、无 `Get-ItemPrivateKey`、无 PFX 导出；仅读 `HasPrivateKey` 布尔标志 |
| 禁删证书清理 | ✅ cleanup 脚本**无任何证书 cmdlet**，仅只读计数；删除证书不在任何脚本范围内 |
| 禁改宿主机 TPM/BitLocker/其他 VM 保护 | ✅ 三脚本无 `Set-Tpm`/`Initialize-Tpm`/`Enable-BitLocker`/`Suspend-BitLocker`/其他 VM 的 `Set-VMSecurity` |
| 不得称「宿主机完全零改动」 | ✅ §7 与 14.2 措辞已改为「明确不做 + 实际产物如实披露」 |
| 额外证书操作需单独授权 | ✅ 已写明；本轮无任何证书写入/删除动作 |

### 14.14 修订回执：清理范围收紧（对应审核 §4）

| 审核要求 | 落实情况 |
|---|---|
| 禁止自动强制关机 | ✅ cleanup rev.3 **无 Stop-VM/Restart-VM 命令**（命令行扫描计数 0）；非 Off 即 `Fail` 并报告 |
| 移除 `-IncludeMedia` | ✅ 参数块整体删除，脚本接受 0 个参数；媒体删除不在任何路径内 |
| 禁删 ISO/WebView2/Evidence/冒烟 VM/真实数据库 | ✅ 头部声明 + 事后只读校验「媒体仍存在且尺寸一致」；Evidence 只写报告不删；父目录不删 |
| 精确识别目标 VM | ✅ 以 creation-record 为**可信身份来源**（非自读自比）：Id/名称/Gen/配置路径/VHDX 路径逐一比对；记录缺失即停 |
| 限制递归删除 | ✅ 完整文件清单 + 双目录白名单（`Virtual Hard Disks\<exact>.vhdx`、`Virtual Machines\<vmId>*`）；未知文件/未知目录/AVHDX/检查点即停；无通配符；不删父目录；删后只读复核 + 报告写入 Evidence |
| 修订后本轮也不得执行 | ✅ 已执行 0 次；文档与脚本头部均标注「仅单独授权后」 |

### 14.15 修订回执：只读验证脚本（对应审核 §5）

verify rev.3 覆盖：名称 / **唯一 Id vs creation-record** / Generation / State / 配置路径 / VHDX 路径 / **网卡数=0** / DVD 路径 / vTPM / Key Protector（只验存在） / Secure Boot + 模板 / 内存 4/1/8 动态 / vCPU=4 / **启动序设备身份** / Default Switch / 冒烟 VM 原状 / **证书存储只读清单** / **AVHDX 与检查点检查** / 媒体尺寸（`-HashMedia` 时比对已知 SHA-256）。**不含任何变更类命令、不写任何文件**；失败只打印实际值不自动修复。

---

## 15. 阶段 2.2 实际创建前最终操作清单（交付第 6 项）

> **前提**：本节只有在「三脚本 rev.3 重新审核通过 + 你单独批准实际创建」之后才可执行。在此之前仅作检查清单浏览。

| # | 步骤 | 命令 / 动作 | 期望 |
|---|---|---|---|
| 1 | 确认已获批准 | 你明确说「批准创建 Fitwise-091-Test」 | 有明确批准记录 |
| 2 | 确认磁盘余量 | `(Get-PSDrive D).Free/1GB` | ≥ 100 GB（脚本内亦设硬门） |
| 3 | 打开**管理员** Windows PowerShell 5.1 | 开始菜单 → Windows PowerShell → 右键「以管理员身份运行」 | 脚本自带管理员守卫，非管理员会直接 `[FAIL]` 退出 |
| 4 | 确认脚本存在且未被改动 | `Get-FileHash "$env:TEMP\fitwise-hyperv-phase2b-create.ps1" -Algorithm SHA256` | 与本轮交付值一致（见 §16 回执） |
| 5 | 建议先跑只读验证（VM 尚不存在时应报「VM 不存在」并退出） | `& "$env:TEMP\fitwise-hyperv-phase2b-verify.ps1"` | 输出 `[FAIL] VM 'Fitwise-091-Test' does not exist`，退出码 1，**这是预期**，证明脚本能正常读到环境 |
| 6 | 执行创建脚本 | `& "$env:TEMP\fitwise-hyperv-phase2b-create.ps1"` | 逐阶段 `[OK]`，最终 `ALL FINAL GATES PASSED` + `PHASE 2.2 COMPLETE` |
| 7 | 记录输出 | 脚本会自建 `Evidence\phase2\phase2b-create-<时间戳>.log` / `phase2b-config-<时间戳>.txt` / `phase2b-creation-record.json` | 三个文件齐备 |
| 8 | 立刻只读复核 | `& "$env:TEMP\fitwise-hyperv-phase2b-verify.ps1"` | `RESULT: PASS`，`failed: 0` |
| 9 | 确认 VM 未被启动 | `(Get-VM -Name "Fitwise-091-Test").State` | `Off` |
| 10 | 记录 VM 唯一 Id | `(Get-VM -Name "Fitwise-091-Test").Id`（应等于 creation-record 的 `vmId`） | 一致 |
| 11 | 停止 | 不做任何手工配置、不启动 VM、不连交换机、不安装 Windows | 等 2.3 单独授权 |

**脚本失败时的固定动作**（不得自行变通）：
1. **不要**重跑脚本（可能已产生部分状态）；
2. **不要**手工补配置、不要手工删 VM；
3. 把三样东西报告回来：①所有 `[FAIL]` 行原文；②若停在 Phase 6，`BootOrder[0]` 的原始 dump；③`Evidence\phase2\` 下对应时间戳的 transcript 路径；
4. 等新的处置授权（可能是修订后重跑、也可能是按 §9 清理后重建）。

**脚本成功后的固定动作**：保存 `phase2b-creation-record.json`（含 `vmId`）与 transcript；在验收记录里写下创建日期（评估版 90 天起算点）与 `vmId`；然后停在「等待 2.3 授权」。

---

## 16. 本轮改动文件与本地提交（交付第 7 项）

| 文件 | 本轮变更 |
|---|---|
| `%TEMP%\fitwise-hyperv-phase2b-create.ps1` | **重写为 rev.3**：WRITE-PHASE MAP、`Get-ShieldedCertList`/`Get-CertDelta`/`Get-BootIdentity`、Phase 0/0W/1–8 重构、严格单网卡门、VM 唯一 Id 落盘、证书前后 delta、启动序设备身份门 |
| `%TEMP%\fitwise-hyperv-phase2b-verify.ps1` | **重写为 rev.3**：VM 唯一 Id 与 creation-record 比对、BootOrder 设备身份 dump + 门、证书存储只读清单、AVHDX/检查点检查、媒体 SHA-256 已知值比对 |
| `%TEMP%\fitwise-hyperv-phase2b-cleanup.ps1` | **重写为 rev.3**：删除 `-IncludeMedia`（无参数）、删除全部关机命令、creation-record 身份校验、设备/检查点校验、文件清单白名单、删后只读复核 + 报告落 Evidence、不删父目录/媒体/证书 |
| `PHASE2_AUTOUNATTEND_TEMPLATE_0.9.1.xml` | **rev.3**：新增 `Password`（占位符 + `PlainText=true`，置于 `Name`/`Group` 前），头部补密码策略说明 |
| `PHASE2_WINDOWS_VM_PREP_PLAN_0.9.1.md` | 状态行、§5（9 阶段 + 7 条 rev.3 修订）、§6.3（模板 rev.3 + 回退路径 B/C/D 重新分级 + 停止纪律）、**新增 §6.6 密码管理**、§7（修正「零改动」措辞）、§9（清理范围收紧）、§14.1/14.2/14.5/14.6/14.8/14.9/14.10 更新、**新增 14.11–14.15 修订回执**、**新增 §15 创建前清单**、本节 |
| `VM_ACCEPTANCE_FEASIBILITY_0.9.1.md` | 新增 §8.4 修订回执 |
| `ISOLATION_ACCEPTANCE_PLAN_0.9.1.md` | 第 3 行状态指针更新为「rev.3 已修订，待重新审核」 |

**脚本哈希（§15 第 4 步核对用；日期 2026-10-24）**：

| 文件 | 大小 | SHA-256 |
|---|---|---|
| `fitwise-hyperv-phase2b-create.ps1` | 34,786 B | `B3A2672ED60D7897318E82CF37E9BBD1F2F76BE95A6996D56F2EC51AC3F6EB21` |
| `fitwise-hyperv-phase2b-verify.ps1` | 15,702 B | `5AEB9C9E4FA24163432B24D79AFD4741A6211974AE5785F9184C5ACDCD6D3389` |
| `fitwise-hyperv-phase2b-cleanup.ps1` | 17,209 B | `5E40403B0F1B2AA28700D0D6A7F659E3AE14F9A35F3E7642195F7CA25B47F385` |

**未改动**：轻衡源码、数据库、0.9.0 安装产物、`Fitwise-091-Smoke`、`Default Switch`、宿主机功能/网络/驱动/组策略、GitHub 远端（本地提交不推送）。

