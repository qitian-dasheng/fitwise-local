# 轻衡 0.9.1｜完整虚拟机验收可行性评估（只读）

日期：2026-10-24（Asia/Shanghai）
分支：`dev/0.9.1`（HEAD `bf1a926`）
性质：**只读评估**。本轮未创建虚拟机、未启用任何系统功能、未安装软件、未下载镜像、未启动候选程序、未修改源码、未执行任何 MSI、未推送/打 tag/发 Release、未读取真实数据库。

---

## 1. 结论摘要（TL;DR）

| 问题 | 结论 |
|---|---|
| 宿主机具备完整 Windows 虚拟机条件吗？ | **具备，且 Hyper-V 平台已安装**：`vmms` 服务运行中、PowerShell 模块 2.0.0.0、Hyper-V 管理器 GUI、全部来宾集成服务、WMI 提供程序均可用。**当前没有任何虚拟机**；有 1 个系统原有 **Default Switch（Internal）**，属既有组件，严禁修改、删除或连接（第 8 节回执）。 |
| 虚拟机验收可行吗？ | **可行，且是当前隔离强度最高的路线**（可同时覆盖 MSI 安装验收，这是免安装路线做不到的）。 |
| 是宿主机零改动吗？ | **不是**。创建 VM 本身就是新增系统配置（见第 4 节完整清单）；虚拟交换机、内存分配、（若发现平台组件不全时的）功能启用+重启都是实际改动。 |
| Sandbox 失败会影响完整 VM 吗？ | **不构成失败证据**（故障层不同：沙盒客户端类 RDP 会话 vs Gen2 VM 固件启动路径），但共享层故障无法排除 → 先用「无盘启动冒烟」降险，失败即停。 |
| 有合法测试镜像吗？ | **本地没有**。推荐 Microsoft 评估中心 Windows 11 企业版评估版 ISO（90 天、测试用途合法免费）；**按你的要求不自动下载**。 |
| 操作约束 | 本会话无提权、RunAs 被安全策略拦截 → **所有 Hyper-V 管理动作须由你本人在管理员 PowerShell 执行**，AI 提供逐条命令与只读核验。 |

---

## 2. 宿主机现状（只读核查结果）

| 类别 | 项 | 结果 | 证据 |
|---|---|---|---|
| Hyper-V 平台 | `vmms`（Hyper-V 虚拟机管理） | **Running / Automatic** | `Get-Service` |
| | `vmcompute`（主机计算服务） | Running / Manual | 同上 |
| | 来宾集成服务 | `vmicguestinterface / vmicheartbeat / vmickvpexchange / vmicrdv / vmicshutdown / vmictimesync / vmicvmsession（PowerShell Direct）/ vmicvss` **全部已安装**（Stopped 为正常待机态，随 VM 启动） | `Win32_Service` |
| | 平台版本 | 注册表 Version `10.0.26100.1`，CurrentVmVersion `12.0`，ListenerPort 2179 | `HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Virtualization` |
| 管理组件 | Hyper-V PowerShell 模块 | 已安装 **2.0.0.0**（Get-VM 报权限错误=平台在位但需管理员，非未安装） | `Get-Module -ListAvailable` |
| | Hyper-V 管理器 / vmconnect | `virtmgmt.msc`、`vmconnect.exe` 均存在 | `Test-Path` |
| 已有虚拟机 | 数量 | **1**：`Fitwise-091-Smoke`（Gen2/512MB/**Off**；网卡已按最小修正授权删至 0；**阶段 1 固件冒烟已通过**，作为阶段 1 证据保留，另册授权清理） | 用户执行回执（第 8.1/8.2 节）；此前为 0 |
| 虚拟交换机 | 数量 | **1**：`Default Switch`（Internal，**系统原有组件**） | 提权 `Get-VMSwitch` 实测（2026-10-24 第 1 步回执，第 8 节）；此前非提权 WMI `Msvm_VirtualEthernetSwitch` 计数 0，与该枚举途径不显示 Default Switch 有关，**以提权实测为准** |
| 虚拟化状态 | HypervisorPresent | **True**；systeminfo：「已检测到虚拟机监控程序」 | `Win32_ComputerSystem` / systeminfo |
| | VBS（基于虚拟化的安全性） | **状态：正在运行**；SecurityServicesRunning=2（内存完整性/HVCI） | systeminfo / DeviceGuard WMI |
| | hypervisorlaunchtype | bcdedit 无覆盖行（默认行为） | `bcdedit /enum` |
| CPU | 型号 | i7-12700H，14 核 / 20 逻辑处理器 | `Win32_Processor` |
| | VT-x/SLAT 属性 | `VirtualizationFirmwareEnabled/SLAT` 显示 False——**这是 hypervisor 已运行时该 WMI 属性的已知读数现象**，与 VBS/Hyper-V 实际运行不矛盾；以 systeminfo「已检测到虚拟机监控程序」为准 | 两来源对照 |
| 内存 | 总量 / 可用 | **31.6 GB / 14.3 GB 可用** | `Win32_OperatingSystem` |
| 磁盘 | C: / D: 可用 | **576 GB / 928.5 GB** | `Win32_LogicalDisk` |
| 宿主 TPM | `Get-Tpm` | 只读查询无返回（**未确认**，不阻断：Gen2 VM 用 vTPM，不需要宿主机 TPM） | `Get-Tpm` |
| 现有镜像 | Downloads/Documents/Desktop 及 Hyper-V 默认目录 | **无** .iso/.vhdx/.vhd；`C:\ProgramData\Microsoft\Windows\Hyper-V\` 尚未创建（从未建过 VM） | find / Test-Path |
| 操作系统 | 版本 | Windows 11 25H2 `26200.9711`，ProfessionalWorkstation 版（支持 Hyper-V） | 前序会话已核实 |

**无法只读确认的项（均需提权，列为阶段 1 核验对象）**：① optional feature 精确状态（DISM 查询需管理员）；② `Get-VM`/`Get-VMSwitch` 枚举（模块需管理员）；③ 宿主机 TPM 详情。

---

## 3. 九个调查点逐项结论

### 3.1 宿主机是否已具备条件 —— 已具备且平台已安装

第 2 节证据链：管理服务运行 + 模块 + GUI + 集成服务 + WMI + 注册表版本齐全。Windows Sandbox 此前已启用并重启过，其依赖的 hypervisor 在运行；**完整 Hyper-V 平台（vmms 等）安装于 2026-09-16**，早于本轮沙盒工作。结论：不需要「从零启用」，但需一次提权只读确认 feature 状态，排除「管理组件在、平台组件缺」的边角情况。

### 3.2 管理组件、虚拟化服务、已有 VM 与交换机状态 —— 见第 2 节表

要点：平台在位；**VM 数=1**（本轮创建的 `Fitwise-091-Smoke`，Off，尚未启动，见第 8.1 节）；**交换机数=1（`Default Switch`，Internal，系统原有组件，严禁修改/删除/连接）**；默认 VM 存储路径为 `C:\ProgramData\Microsoft\Windows\Hyper-V\`（尚未使用，本轮 VM 用自选路径 `D:\HyperV-QH-Test`）。

### 3.3 创建测试 VM 需要改变宿主机什么 —— 明确非零改动清单

| # | 改动 | 说明 | 可逆性 |
|---|---|---|---|
| 1 | 创建 VM 定义 + VHDX | 写入默认或自选路径（建议 `D:\HyperV-QH-Test`，D: 928 GB 可用） | 删 VM+VHDX 即还原 |
| 2 | 新建 1 个虚拟交换机 | **只建 Internal 或 Private**（不碰物理网卡）；**严禁 External**（会绑定宿主网卡、改宿主网络）；**严禁触碰现有 `Default Switch`**（系统原有组件，第 8 节） | 删除自建交换机即还原 |
| 3 | 资源分配 | Gen2、4 vCPU、动态内存（启动 2048 MB / 最小 1024 MB / 最大 6144 MB） | 随 VM 删除消失 |
| 4 | （条件性）启用功能 + 重启 | **仅当**提权确认发现平台组件不完整时；当前证据倾向已完整，大概率不需要 | 禁用+重启还原 |
| 5 | （不采用）增强会话模式 | 默认不开启（避免改 Hyper-V 主机设置）；用 vmconnect 标准会话 | 若误开可关 |

**明确不做**：不改物理网络/防火墙/驱动/组策略、不动 Sandbox 设置、不碰正式版 0.9.0 与真实库、不映射宿主持久目录。

### 3.4 测试系统映像 —— 无本地合法镜像；获取方式、许可与磁盘

- **本地现状**：无任何 ISO/VHD/VHDX。
- **推荐**：Microsoft 评估中心 **Windows 11 企业版评估版 ISO**（90 天有效期，评估/测试用途合法免费，约 5–6 GB 下载）。**按你的要求本轮不自动下载**——由你下载，或单独授权后由 AI 下载。
- **备选**：你已有的零售/OEM 产品密钥 + 官方 Media Creation Tool 制作 ISO。
- **不推荐**：Disk2VHD 复制宿主系统（同一许可不覆盖单独 VM 实例）；来源不明 ISO。
- **磁盘需求**（宿主）：ISO 缓存 ~6 GB（装后可删）；VHDX 建 60 GB 动态上限（Win11+更新+WebView2 实际增长约 25–35 GB）；检查点约 5–15 GB。**峰值约 50–70 GB**，C:（576 GB free）或 D:（928 GB free）均足够，建议 VHDX 放 D:。

### 3.5 Sandbox 失败是否影响完整 VM —— 不同故障层；最小冒烟降险

**分层对比**：

| 层 | Windows Sandbox | 完整 Gen2 VM |
|---|---|---|
| hypervisor / VMMS / worker / VM 总线 | 使用 | 使用（**共享层**） |
| 系统映像准备 | Containers-DisposableClientVM 容器快照/arrest | 完整磁盘 + UEFI 固件启动 |
| 会话/显示 | 沙盒客户端类 RDP 会话（**0x80072746 签名所在层**） | vmconnect/Hyper-V 管理器 + 合成显示适配器 |
| GPU | 默认走 vGPU/GPU-PV 共享 | **Gen2 默认不使用 GPU-PV** |

- 沙盒两次失败（默认配置 3 分 10 秒后 0x80072746；VGpu=Disable 后 20–30 秒即退）指向**沙盒客户端/映像准备层**；完整 VM 走的是不同启动与会话路径，且天然避开可疑的 vGPU 路径。
- **但共享层（hypervisor/VMMS/VM 总线）故障无法仅凭沙盒排除**——因此必须先做最小冒烟。
- **最小冒烟（零下载、零安装、零镜像）**：提权创建一个 Gen2 VM（无磁盘、2 GB 内存、无交换机）→ 启动一次 → **预期看到 UEFI/「无引导设备」类固件画面**＝VM 创建/启动/视频路径通畅的硬证据；若黑屏/即退/报错 → 停止 VM 路线，转入第 3.9 节用户账户备选或深层宿主机排查（另需授权）。

### 3.6 如何只读交付候选 MSI 给虚拟机 —— 两种方案，均不映射宿主目录

| 方案 | 机制 | 宿主改动 | 评价 |
|---|---|---|---|
| **A. PowerShell Direct（推荐）** | 经 VM 总线直连来宾会话（`Copy-VMFile` / `Copy-Item -ToSession`），**不需要网络、不需要 ISO 工具** | 无（vmicvmsession 已装） | 只传送 MSI 单文件；凭据由你现场输入（AI 会话无法代输密码） |
| B. 临时 ISO | 用仅含 MSI 副本的 ISO 挂载进 VM | 需 ISO 制作工具（`New-IsoFile` 脚本或 ADK `oscdimg`，**均未安装**，需另行授权） | 作为 A 的备选 |

**明确不做（硬性）**：不映射宿主持久文件夹；不启用任何文件夹共享；不开宿主 SMB；不映射任何包含真实数据库或用户 profile 的目录；候选 MSI 以**副本**形式交付（源文件不动），交付前后记录 SHA-256。需送入 VM 的文件仅：候选 0.9.1 MSI + 0.9.0 MSI（升级测试用，见 3.7）。

### 3.7 虚拟机内四项验证设计

| 验证 | 步骤 | 通过标准 |
|---|---|---|
| **① 0.9.1 全新安装** | VM 内安装候选 MSI → 验证安装位置/快捷方式/卸载项 → 首启（VM 内全新用户配置文件，自动建 v14 空库）→ 按 `BUILD_REPORT_0.9.1.md` 第 6 节清单用**合成数据**跑：今日/饮食/身体页、R1 菜谱入餐（×0.5/×1/×2）、R2 篮子合计+行内改量、R3 照搬任意来源日期、R4-A 搜索排序、OBS-006 归档/删除/纠错、JSON 导出 | 全清单通过；导出 JSON 结构合法 |
| **② 合成 0.9.0 数据升级** | VM 内先装 **0.9.0 MSI** → 录入合成数据 → 导出 JSON 基线（条数/热量/快照哈希）→ 覆盖安装 0.9.1 MSI → 首启 → 对账 | 数据逐项一致、无丢失；**这是 0.9.0→0.9.1 真实数据保留能力的唯一实测途径**（既往升级印象不作数，见 `RESET_ACCEPTANCE_0.9.0.md` 第 9 节） |
| **③ 备份恢复** | VM 内冷备份整个 `%APPDATA%\cn.fitwise.local` 目录（记录 SHA-256）→ 制造变更（或执行重置）→ 从备份还原 → 校验 | 字节级一致 + 应用可正常读取 |
| **④ 数据一致性** | 升级前后导出 JSON 逐项对账（实体条数、营养合计、快照哈希）+ 库元数据比对 | 全部一致（同 `BUILD_REPORT_0.9.1.md` 第 6 节第 3 条口径） |

**附加收益**（VM 路线独有）：可顺带验证 0.9.1 数据装回 0.9.0 的反向兼容/降级路径；可在全新 Windows 环境验证 WebView2 缺失场景；安装交互（UAC/快捷方式/卸载项）也在此覆盖。

### 3.8 如何证明虚拟机不会覆盖宿主机正式版 0.9.0

| 层 | 证明 |
|---|---|
| 架构层 | VM 有独立内核与独立存储；**无映射文件夹**；隔离阶段用 Private 交换机（来宾与宿主完全不可达）。注意：Default Switch（NAT）下来宾可经网关 IP 到达宿主——因此**全程不开宿主文件共享/SMB**，且隔离阶段一律用 Private |
| 操作层 | 进入 VM 的只有 MSI 单文件副本；PowerShell Direct 仅由你主动发起；不挂载任何宿主磁盘/VHDX |
| 证据层 | 宿主机元数据前后快照（与路线 D 报告 3.7 同口径，只查元数据不读库内容）：`%APPDATA%\cn.fitwise.local\`、`%LOCALAPPDATA%\cn.fitwise.local\`、`C:\Program Files\轻衡\`、`fitwise-local.exe` 进程数=0；测试窗口期内不启动正式版 0.9.0 |
| 回滚层 | VM 检查点/删除 VM，宿主机侧无该 VM 的任何持久痕迹（除第 4 节列出的可逆改动） |

### 3.9 备选：独立 Windows 用户仅做 EXE 功能冒烟（虚拟机不可行时）

- **安全性**：KnownFolder 按访问令牌解析 → 新用户拥有独立 `%APPDATA%`/`%LOCALAPPDATA%`；真实库位于 `C:\Users\21904\...` 下，用户配置文件目录 ACL 默认仅本人+管理员可访问 → 新标准用户**结构上碰不到真实库**（这是保护而非假设）。
- **限制**：① 不覆盖 MSI 安装/升级/备份恢复/发布验收（仅功能冒烟，不作发布依据）；② 需创建本地账户（持久系统改动，测后须删账户+配置文件）；③ RunAs 需你现场输密码（`/savecred` 会缓存凭据，不建议）；④ WebView2 Evergreen 为 per-machine 运行时，新用户可用；⑤ 退出清理必须彻底（账户+profile+暂存 exe）。
- **定位**：虚拟机不可行时的次选；优先级低于 VM。

---

## 4. 资源需求与宿主机改动总清单（**非零改动**，明确列出）

| 类别 | 项目 | 具体值 / 动作 | 可逆性 |
|---|---|---|---|
| 系统配置 | VM 定义 | Gen2、UEFI Secure Boot（Microsoft UEFI CA 模板）、4 vCPU、动态内存 1024–6144 MB、TPM 开启 vTPM（不需宿主 TPM）、检查点可选 | 删 VM 还原 |
| | 虚拟交换机 | 1 个 Private（隔离阶段）；联网阶段临时换 Default Switch（NAT） | 删交换机还原 |
| | 功能启用+重启 | **条件性**：仅当提权发现平台组件不全时（当前证据倾向不需要） | 禁用+重启还原 |
| 磁盘 | VHDX | 60 GB 动态，建议 `D:\HyperV-QH-Test` | 删除还原 |
| | ISO 缓存 | ~6 GB（安装后可删） | 删除还原 |
| | 检查点 | ~5–15 GB | 删除还原 |
| 网络 | 隔离阶段 | Private 交换机（无网） | — |
| | 联网阶段 | Default Switch（NAT），仅用于下载 WebView2 运行时/Windows 更新 | — |
| | 禁止 | External 交换机、宿主文件共享、SMB | — |
| 软件安装 | 宿主机 | **无新增**（Hyper-V 已在位）；ISO 工具仅当选方案 B（未装，需授权） | — |
| | VM 内 | WebView2 Evergreen Standalone（x64）+ 候选 0.9.1 MSI + 0.9.0 MSI | 随 VM 销毁 |
| 凭据 | PowerShell Direct | VM 内本地账户 + 密码（你现场输入，AI 不接触） | — |
| 回滚 | 完整步骤 | ① 关 VM → ② 删 VM + VHDX + 检查点 → ③ 删虚拟交换机 → ④ 还原增强会话设置（若改过） → ⑤ 删 MSI 暂存副本 → ⑥ 宿主机元数据复核（第 3.8 节口径） → ⑦（如启用过功能）禁用功能 + 重启 | — |

---

## 5. 风险清单

| 风险 | 等级 | 缓解 |
|---|---|---|
| 沙盒失败根因未知，共享层（hypervisor/VMMS/VM 总线）可能同样故障 | 中 | 无盘冒烟先行；失败即停转备选路线，不反复重试 |
| 本会话无提权，RunAs/DISM 被安全策略拦截，所有管理动作须你本人执行 | 流程约束 | AI 提供逐条可复制命令 + 只读核验脚本；每步给停止点 |
| 宿主可用内存 14.3 GB，VM 占 4–6 GB 期间宿主紧张 | 低 | 动态内存；VM 用时暂停宿主重应用；不用即关机 |
| 评估版 90 天有效期 | 低 | 测试周期足够；记录安装日期；到期删 VM |
| 宿主 TPM 只读未确认 | 低 | vTPM 不需宿主 TPM；若 Win11 评估版装不上再退回 Win10 评估版 |
| VM 内误操作（挂入宿主磁盘/映射真实目录） | 中 | 3.6 节硬性禁止清单；所有 VM 配置命令 AI 预审后交你执行 |
| 现有 `Default Switch` 被误改/误删/误连 | 中 | **硬性规则：严禁修改、删除或连接 `Default Switch`**（系统原有组件，非本轮创建；后续如需联网阶段另建自建交换机，与此开关无关） |
| Default Switch 阶段来宾可经网关到达宿主 IP | 低 | 全程不开宿主文件共享；隔离阶段一律 Private（且不得改用/连接 Default Switch 替代） | 

---

## 6. 分阶段授权建议

| 阶段 | 内容 | 授权点 | 停止点 |
|---|---|---|---|
| **1. 冒烟验证** | ① 提权只读确认 feature 状态；② 创建「无盘 Gen2 冒烟 VM」并启动一次；③ 观察固件画面 | 需授权：提权只读查询 + 创建冒烟 VM + 启动一次 | 冒烟成败即停：失败→停 VM 路线重议；成功→进阶段 2 |
| | **✅ 已完成（2026-10-24，结果：通过，见第 8.2 节）** | | |
| **2. 镜像与运行时** | ① 提供/下载 Win11 评估 ISO（你执行或单独授权）；② VM 安装系统；③ VM 内装 WebView2 Evergreen Standalone | 需授权：镜像获取方式 + VM 安装 | 装完即停 |
| **3. 候选安装冒烟** | ① MSI 副本经 PowerShell Direct 送入 VM（你输凭据）；② VM 内全新安装 0.9.1；③ 合成数据功能验收（3.7①） | 需授权：送文件 + VM 内安装候选 MSI | 验收结果即停 |
| **4. 升级与对账** | ① VM 内 0.9.0→0.9.1 合成升级（3.7②）；② 备份恢复（3.7③）；③ 一致性对账（3.7④）；④ 输出报告 | 需授权：0.9.0 MSI 送入 + VM 内安装/升级操作 | 报告完成即停 |
| **5. 另行授权（不在 VM 范围）** | 真实库受控副本对账、正式环境升级、GitHub 发布 | 需单独授权 | — |

---

## 7. 边界声明

本轮全程（截至第 8.2 节回执时点）：未启用任何系统功能、未安装软件、未下载镜像、未启动候选程序、未修改源码、未执行 MSI、未读取/复制/修改真实数据库、未操作正式版 0.9.0、未推送 GitHub/未创建 tag 或 Release。宿主机状态均为只读查询所得；临时 VM `Fitwise-091-Smoke` 由**用户本人**执行 AI 提供的脚本创建并启动一次（Gen2、无盘、0 网卡、512MB），全程未连接任何交换机、未映射宿主目录，现已正常关机（Off）。「已验证事实」均给出处，无法只读确认的项已明确标注（第 2 节末）。

---

## 8. 阶段 1 第 1 步实测回执（2026-10-24，用户管理员终端执行）

**结论：GO**（脚本 `%TEMP%\fitwise-hyperv-phase1-confirm.ps1` 输出，用户回贴）：

| 核查项 | 结果 |
|---|---|
| Hyper-V 平台功能 | **Enabled**（4 项 feature 全部启用，无需再启用功能/重启） |
| 虚拟机管理服务 | 正常 |
| 同名测试 VM | **无冲突** |
| 现有虚拟机 | **VM count = 0** |
| 虚拟交换机 | **1 个：`Default Switch`（Internal）——系统原有组件** |
| 测试目录 | `D:\HyperV-QH-Test` 当前**不存在**（第 2 步脚本自动创建） |
| D: 可用空间 | **928.5 GB**（充足） |
| 脚本判定 | **GO**：平台 Enabled、服务正常、无名称冲突、空间充足 |

**宿主机事实记录更新（据此修订第 2 节表）**：

1. **`Default Switch` 已存在，类型 Internal，属系统原有组件，严禁修改、删除或连接**。此前非提权 WMI `Msvm_VirtualEthernetSwitch` 计数为 0，该枚举途径不显示 Default Switch；以本次提权 `Get-VMSwitch` 实测为准。
2. VM 数仍为 0；`D:\HyperV-QH-Test` 尚不存在（冒烟脚本会创建）；D: 928.5 GB 可用。
3. Hyper-V 平台组件已完整 Enabled → 第 3.3 节改动清单第 4 行（条件性启用功能+重启）**确认不需要**。

**冒烟脚本相应调整（第 2 步，用户 2026-10-24 要求）**：取消「固定 25 秒后自动强制关机」；改为创建并启动后**等待用户自行观察固件画面**（脚本内 `Read-Host` 阻塞等待），观察确认并截图后按回车记录证据；**VM 保持运行，由用户单独执行关机命令**；第 3 步受控清理脚本不变（含「非 Off 状态先强制关机」守卫）。其余隔离边界（Gen2、无盘、无网卡、无交换机连接、无映射、无增强会话）不变。

### 8.1 第 2 步首次执行异常回执（2026-10-24）与最小修正授权

**VM 创建成功**（脚本 rev.2 执行结果，用户回贴）：

| 项 | 值 |
|---|---|
| 名称 | `Fitwise-091-Smoke` |
| Generation | 2 |
| 启动内存 | 512 MB |
| 配置目录 | `D:\HyperV-QH-Test\Fitwise-091-Smoke` |
| 当前状态 | **Off**（安全门触发时尚未启动） |
| 虚拟硬盘 | 0 |
| DVD 驱动器 | 0 |
| 虚拟网卡 | **1**（计划为 0） |

**异常事实**：`New-VM` 默认附带 1 块合成网卡（Name＝「网络适配器」），rev.2 脚本的 0 网卡安全门据此正确触发 FAIL——**VM 未启动，不能认定为 Hyper-V 启动失败**。用户只读核查确认：该网卡 `SwitchName` 为空、`MacAddress=000000000000`、未连接任何交换机；`Default Switch` 未被触碰。

**最小修正授权（用户 2026-10-24 批准，仅此一项）**：仅删除 `Fitwise-091-Smoke` 上这一块未连接网卡；不删除/重建 VM；不连接任何交换机。修正后复核 0 硬盘 / 0 网卡 / 0 DVD、Gen2、State=Off，任一不满足即停止。

**修正通过后的续行（用户批准）**：启动**现有** VM（不再运行创建脚本）→ Hyper-V 管理器连接观察固件画面（无时间限制）→ 用户确认后单独执行关机命令 → 保留 VM 与文件清单等待受控清理授权。

**脚本修订（rev.3，已交付未运行）**：`New-VM` 后显式移除默认网卡（带「未连接交换机」守卫，经对象管道删除，名称随对象取本地化值），再执行 0/0/0 安全门。**不得为测试 rev.3 而再次创建 VM。**

### 8.2 阶段 1 判定：**通过**（2026-10-24，用户回执）

网卡最小修正后，冒烟续行完成。用户确认的实际结果：

| 核查项 | 结果 |
|---|---|
| VM 名称 / Generation | `Fitwise-091-Smoke` / **2** |
| 虚拟硬盘 / 虚拟网卡 / DVD | **0 / 0 / 0** |
| VM 状态 | **Running**（启动成功；Hyper-V 管理器可连接，控制台走 VM 总线、0 网卡不影响） |
| 固件画面 | **实际可见**：Microsoft Hyper-V UEFI 固件界面，显示 *No boot devices were found / No operating system was loaded* |
| 画面符合预期 | 是——该 VM 刻意无任何启动设备，固件找不到引导项即预期 PASS |
| 观察方式 | 用户自行连接观察并截图，无固定时长倒计时；确认后单独执行关机命令 |
| 关机后状态 | Off，VM 与 `D:\HyperV-QH-Test` 创建文件保留，待受控清理授权 |

**网卡修正经过（保留备查）**：`New-VM` 默认附带 1 块未连接网卡 → 0 网卡安全门 FAIL（VM 未启动）→ 用户只读确认未连交换机 → 按最小授权仅删该网卡 → 复核 0/0/0 通过 → 启动观测通过。全过程未删除/重建 VM、未触碰 `Default Switch`。

**本阶段验证边界（防止外推）**：仅验证**基础 VM 创建、启动、控制台与固件显示**。**Windows 来宾系统、MSI 安装、0.9.0→0.9.1 升级保留、备份恢复、数据一致性均未验证**（State=Running 不等于固件画面验收通过，固件画面通过也不等于 Windows 来宾通过）。

**证据（已归档）**：固件截图存档于 `D:\HyperV-QH-Test\Evidence\phase1\fitwise-091-smoke-firmware-20261024.png`（105,728 字节，SHA-256 `03c3389dfa30ea60cee7355a008929202ff997905ed4968a5f346749b9feacb9`；内容：Microsoft Hyper-V UEFI / Virtual Machine Boot Summary / No boot devices were found / No operating system was loaded / Restart now，窗口标题「JR 上的 Fitwise-091-Smoke - 虚拟机连接」，状态栏「正在运行」）。transcript 日志在 `%TEMP%\fitwise-hyperv-smoke-*.log`。2026-10-24 19:45 由用户提供截图后归档。

**下一步**：仅制定阶段 2（Windows 虚拟机环境准备）方案，见 `PHASE2_WINDOWS_VM_PREP_PLAN_0.9.1.md`；等待用户批准后执行。

### 8.3 阶段 2.2 交付回执（2026-10-24：脚本与安全检查已交付，未执行创建）

用户原则批准阶段 2.2 但要求**先交付创建脚本和安全检查**。本轮 AI 侧只读完成：

| 交付物 | 状态 |
|---|---|
| `fitwise-hyperv-phase2b-create.ps1` | ✅ 已交付（8 阶段+验证门+守卫+异常即停；Parser 无语法错误；纯 ASCII；0 处启动命令） |
| `fitwise-hyperv-phase2b-verify.ps1` | ✅ 已交付（只读全量复核，`-HashMedia` 可选） |
| `fitwise-hyperv-phase2b-cleanup.ps1` | ✅ 已交付（五重守卫+显式路径+无通配符；`-IncludeMedia` 可选） |
| `PHASE2_AUTOUNATTEND_TEMPLATE_0.9.1.xml` | ✅ 已交付（Python XML 解析通过；独立副本） |
| 方案文档更新 | ✅ 第 5 节（脚本化+修订点）、6.3（应答文件审核+scope 移除）、6.5（第二 DVD 制作：IMAPI2FS）、第 14 节（完整交付清单） |

**创建前 8 项核实的落实位置**：①VM 不存在（Phase 0 名称守卫）②冒烟 VM Off 不改（Phase 0+7 双重核查）③Default Switch 原状（Phase 0 指纹+Phase 7 复核）④路径与磁盘空间（Phase 0，≥100 GB 门）⑤vTPM/Key Protector/Secure Boot 顺序与语法（Phase 3→4，顺序＝Key Protector→vTPM→Secure Boot，均需 Off）⑥动态 VHDX/克隆/检查点开销（14.4 节量化）⑦分阶段+守卫+异常即停+不自动清理重建（脚本结构）⑧完整语法与范围审查（Parser+ASCII+网卡遗漏专项核查：创建脚本仅 1 处 `Remove-VMNetworkAdapter` 且带守卫）。

**autounattend.xml 自动发现依据**：MSDN dn938367 隐式搜索顺序路径⑤「可移动只读介质根目录」——第二块虚拟 DVD 属此类，**有官方文档依据**；安装时实证，未命中转 6.3 路径 B/C/D。制作第二 DVD 用微软 IMAPI2FS API（离线、无需 ADK），见 6.5。

**本轮未执行（停止点）**：未创建/启动 VM、未装 Windows、未运行 WebView2/MSI、未访问真实数据库、未改宿主机功能/网络/交换机、未触碰冒烟 VM 与 Default Switch、未改源码、未推送 GitHub。等待用户检查确认后授权执行创建。

### 8.4 阶段 2.2 安全修订回执（2026-10-24 rev.3：按用户审核意见修订，仍未执行）

用户认可技术方案原则，但指出安全边界缺陷，**本轮仅授权修改脚本/应答文件/文档**。逐项落实：

| 审核条目 | 缺陷（rev.2） | rev.3 修正 |
|---|---|---|
| §2.1 网卡删除 | `foreach` 遍历删除，不满足「恰好一块」 | 严格计数门：`Count -ne 1` 即停（0/多块都停）；`SwitchName` 非空即停；**无循环**；删前重读 VM 并核对自 Phase 1 记录的 **唯一 Id** + Gen2 + Off；删后验证 0 |
| §2.2 启动序核查 | 直接读 `BootOrder[0].Path`，属属性假设 | `Get-BootIdentity` 经 `.Device` 取真实设备对象，四道门（有 Device→类型 DvdDrive→`.Device.Path` 逐字等于 ISO→控制器三元组交叉核对）；**无法验证即返回 ok=false、dump 原始模型并停止，不伪造 PASS** |
| §2.3 创建前后保护 | 未记录 VM 唯一 ID；Evidence/日志/快照被混称「只读预检」 | Phase 1 写 `phase2b-creation-record.json`（含 `vmId`）；头部 **WRITE-PHASE MAP** 明确 Phase 0 只读 / 0W·1·2–6·8 写入范围与文件；`New-VM` 无 `-Force`；无提权绕过 |
| §3 vTPM/证书 | 只做口头披露，无前后核对 | 证书存储**只读**基线 + after + delta（subject/thumbprint/有效期/HasPrivateKey 标志），写入 creation-record；**不读不导出私钥、不删证书、不改宿主 TPM/BitLocker/其他 VM 保护**；「宿主机零改动」措辞已在 §7 修正 |
| §4.1 清理关机 | 非 Off 时 `Stop-VM -TurnOff -Force` | **删除全部关机命令**；非 Off 即 `[FAIL]` 停止并报告 |
| §4.2 清理范围 | `-IncludeMedia` 可删媒体；父目录空则删 | 参数块整体删除；媒体/Evidence/冒烟 VM/证书/父目录**永不触碰**；事后只读校验媒体仍存在 |
| §4.3 VM 身份 | 从待删对象自读属性比对 | 以 **creation-record（创建时可信记录）** 为身份来源：Id/名称/Gen/配置路径/VHDX 路径逐一比对；记录缺失即停 |
| §4.4 递归删除 | 直接 `Remove-Item -Recurse` | 先枚举**完整文件清单**并过白名单（`Virtual Hard Disks\<exact>.vhdx`、`Virtual Machines\<vmId>*`）；未知文件/目录/AVHDX/检查点即停；无通配符；删后只读复核 + 报告落 Evidence |
| §5 只读验证 | 缺少唯一 Id、启动序身份、证书清单 | 全部补齐（详见阶段 2 方案 14.15）；**0 变更命令、0 文件写入** |
| §6 应答文件 | 空白密码账户 | 新增 `Password`（占位符 `__FITWISE_TEST_PASSWORD__` + `PlainText=true`，置于 Name/Group 前）；密码生命周期见方案 §6.6；回退路径 B/C/D 改为**需单独授权**，OOBE 不符预期即停 |

**机器自检（2026-10-24）**：三脚本 Parser 0 错误、纯 ASCII 0 非 ASCII 字节；create 无 `Start-VM`/`Stop-VM`/`Remove-VM`/`Remove-Item`；cleanup 无 `Stop-VM`/`Restart-VM`、无 `param` 块；三脚本通配符删除计数 0；应答文件 Python XML 解析通过、`LocalAccount` 子元素顺序 = `Password, Name, Group`。

**未执行（本轮停止点）**：未创建/启动/停止/删除任何 VM、未创建/删除 VHDX、未安装 Windows/WebView2/MSI、未执行清理脚本、未改宿主机功能/交换机/驱动/组策略/网络、未写或删宿主机证书、未读真实数据库、未改 0.9.0、未改源码、未推送 GitHub。**等待重新审核三脚本并单独批准实际创建。**

### 8.5 阶段 2.2 rev.4 最终代码审查回执（2026-10-24，仍未执行）

用户完成对 rev.3 的静态代码审查（三个文件 SHA-256 与交付记录一致），认可整体方向但指出 6 组剩余问题。本轮**只修订这 6 组，不扩大范围**：

| 审查组 | 缺陷（rev.3） | rev.4 落实 |
|---|---|---|
| 1 清理白名单与遍历 | `<vmId>*` 前缀匹配；`Get-ChildItem` 可能 `SilentlyContinue` 导致不完整清单通过；未拒绝重解析点；清单与实际内容之间可能变化 | 闭环精确白名单（4 个固定扩展名 + 精确 VHDX 名）；枚举全部 `-ErrorAction Stop -Force`，失败即停；拒绝 VM 根/目录/文件上的 `ReparsePoint`；TOCTOU 二次枚举 + 名称/字节数/时间戳签名比对；保留精确路径/VM Id/Generation/Off 检查 |
| 2 创建记录完整性 | 清理只要求记录「存在」；未校验 `finalizedUtc`/`finalState`/`bootOrderVerified`；部分创建失败仍可走常规清理 | 记录必须 `completionStatus=complete` + `finalizedUtc` 非空 + `bootOrderVerified=true` + `gateFailCount=0` + `gatePassCount=gateTotalCount>0` + `finalState`＝实测；部分创建一律拒绝并提示另交恢复方案；新增 schema `/2` + 14 字段 SHA-256 指纹（不再仅凭存在可信） |
| 3 创建脚本日志与终态 | 无条件 `Stop-Transcript`；记录写入失败只 `Info` 后仍打印全通过；未把快照/记录/验证结果纳入验收；未区分「已创建但失败」与「完整成功」 | `$script:transcriptStarted` 守卫；记录/快照写入失败一律硬 `Fail`；新增 Phase 8 最终验收 15 项；三种终态文案明确区分，失败写 `incomplete` 记录 |
| 4 清理报告真实性 | 失败固定输出「Nothing was deleted」 | 三态进度（VM 定义/VHDX/目录）+ 逐文件日志；失败打印实况并声明「不得假设什么都没删」；中途失败立即停止，不重建/不恢复/不猜测 |
| 5 验证脚本一致性 | 启动序检查比 create 宽松；读不到属性时可能被当作 PASS | 复用与 create **完全相同**的四道门（含控制器三元组交叉核对），缺失即 `GAP` → `[FAIL]`；AVHDX 枚举失败也报 GAP；保持纯只读 |
| 6 重新交付 | — | 三个完整 `.ps1` + SHA-256（create 41,888 B / verify 22,140 B / cleanup 28,683 B）+ Parser 0 错误 + 纯 ASCII + rev.3→rev.4 差异摘要（见阶段 2 方案 §16） |

**机器自检**：三脚本 Parser 0 错误、纯 ASCII 0 非 ASCII 字节无 BOM；create 0 处 Start/Stop/Remove-VM/Remove-Item 且 `Stop-Transcript` 仅 1 处受守卫；verify 0 变更命令、0 文件写入；cleanup 0 处 `Remove-Item -Recurse`、0 处 Stop-VM、无 param 块、无 `Get-ChildItem ... SilentlyContinue`。离机自检另含：指纹在哈希表与 JSON 回读间一致、篡改可检出；白名单模拟目录测试中 `.vmcx.bak`（前缀伪装）、`stray.log`、`Snapshots\` 均被拒。

**未执行（本轮停止点）**：未创建/启动/停止/删除任何 VM 或 VHDX、未安装 Windows/WebView2/轻衡、未执行清理脚本、未删任何文件、未改宿主机功能/交换机/驱动/组策略/网络、未写删宿主机证书、未读真实数据库、未改 0.9.0/源码、未推送 GitHub。**等待最终复审并单独批准实际创建。**

### 8.6 阶段 2.2 rev.5 最终状态一致性修复回执（2026-10-24，仍未执行）

rev.4 复审确认了脚本来源（SHA-256 对照），但指出 3 组问题。本轮**只修这 3 组**，不扩大范围、不降低 BootOrder 控制器身份检查标准：

| 审查组 | 缺陷（rev.4） | rev.5 落实 |
|---|---|---|
| 1 记录完成状态与验收顺序 | `Save-Record "complete"` 在 15 项最终验收之前执行 → 验收失败时磁盘记录仍是 complete | Phase 8 拆四段：快照(写) → **预验收(只读，断言记录仍为 incomplete)** → **提交(唯一写 complete 的点)** → **读回确认(只读)**。预验收失败写 incomplete+原因；提交/确认失败回退写 incomplete；回退亦失败则 `[WARN]` 记录不可信。明确区分「配置与证据预验收」与「最终记录提交确认」，消除循环依赖 |
| 2 transcript 失败停止 | `Start-Transcript` 失败仅提示后继续创建 | 失败即 `Fail`，且发生在 `New-VM` **之前**；额外校验日志文件存在；`Stop-Transcript` 仍受成功标志保护；报告日志路径与收尾结果（CLOSED / CLOSE FAILED / 未启动） |
| 3 清理查询遇错停止 | `Get-VMHardDiskDrive`/`Get-VMDvdDrive`/`Get-VMNetworkAdapter`/`Get-VMSnapshot` 用 `-ErrorAction SilentlyContinue`，异常会被读成 0 盘/0 网卡/0 检查点 | 新增 `Get-CheckedList`（`-ErrorAction Stop` + try/catch → `Fail`），四个 cmdlet 及 `Get-VM` 枚举、事后 `Get-VMSwitch` 全部改经它；异常即停、绝不当作空结果；删除前打印「所有安全检查已完成、尚未删除任何东西」 |

**离机自检结果**（脚本函数由 AST 从源文件原样提取执行，保证同源；全部在 `%TEMP%` 临时目录完成并清理）：① 记录状态顺序——预验收失败后记录仍 `incomplete` 且文件中无 `"completionStatus": "complete"`；提交成功后被模拟的确认失败可回退为 `incomplete`；截断文件不可解析、篡改字段指纹不匹配。② 查询异常——四个 cmdlet 在真实权限异常下**全部路由到 `Fail`**（消息含 cmdlet 名 + "stopping BEFORE any deletion"），真实 `Fail` 退出码 1；正常查询与空结果分别返回 3 / 0 项，空结果不被误判为异常。

**脚本哈希（rev.5）**：create 51,149 B `D1EB24F4…EEB341C1`；verify 22,140 B `8F3BB71B…EC85C754`（本轮未改）；cleanup 29,886 B `307F5935…D9097A8F`。Parser 0 错误、纯 ASCII。

**未执行（本轮停止点）**：未创建/启动/停止/删除任何 VM 或 VHDX、未安装 Windows/WebView2/轻衡、未执行清理脚本、未删文件、未改宿主机功能/交换机/驱动/组策略/网络、未写删证书、未读真实库、未改 0.9.0/源码、未推送 GitHub、**未向 `D:\HyperV-QH-Test` 写入任何内容**（测试仅在 `%TEMP%`）。**等待最终复审。**
