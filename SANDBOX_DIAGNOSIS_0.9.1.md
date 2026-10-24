# 轻衡 0.9.1｜Windows Sandbox 启动失败诊断报告

日期：2026-10-24 17:40｜范围：**只读诊断**（两轮实测 + 公开社区经验对照）
**沙盒启动验收状态：失败，待诊断**（不得标记通过；隔离安装验收未开始）

现象链（用户实测 + 日志互证）：

| 时间（2026-10-24） | 事件 | 来源 |
|---|---|---|
| 16:43:43 | 宿主机重启完成（Sandbox 功能启用后） | 系统日志 |
| 17:21:42 | 沙盒 VM（`666304AB-29C8-4DB6-927A-06226ECAB48F`）启动，VM 总线/默认交换机/NIC 就绪 | Hyper-V-VmSwitch-Operational |
| 17:21:42–17:24:52 | 窗口可见但**黑屏**，VM 处于 Running 状态约 3 分 10 秒 | 同上 + 用户截图 |
| 17:24:52 | VM 被暂停/拆除（Vmbus pause → Channel Pause → Completed Pause，NIC 断开） | 同上 |
| ≈17:25:47 | 弹错「与沙盒的连接已丢失。Error 0x80072746」 | 用户截图 |

---

## 一、本轮纪律（授权范围内）

仅执行只读查询：事件日志、服务/进程状态、注册表策略键（只读）、CBS 包状态（只读）、GPU/驱动元数据、更新历史、目录元数据列举。
**未做**：不修改系统设置/组策略/驱动/网络/虚拟化组件；不重新启用或禁用 Sandbox；不下载或安装任何软件；不安装 0.9.1 MSI；不访问轻衡真实数据库（诊断全程未触及 `%APPDATA%\cn.fitwise.local`）。
**已排除事项**（按你 17:28 补充）：开始菜单入口缺失——你已确认英文关键词「windows sandbox」可找到系统程序并显示「打开」；中文搜索无结果属搜索匹配问题，不代表入口缺失。

## 二、环境与客户端状态（实测）

| 项目 | 实测值 | 备注 |
|---|---|---|
| OS | Microsoft Windows 11 专业工作站版，build **26200.9711**（25H2） | 注册表 ProductName 字符串仍显示 "Windows 10 Pro for Workstations"（映像品牌串，以构建号为准） |
| 会话类型 | 本地会话（SESSIONNAME 为空；TermService/UmRdpService 停止） | **排除** RDP 会话限制这一已知黑屏成因 |
| Sandbox 功能 | Enabled（你以管理员命令确认）；CBS `Containers-DisposableClientVM-Package~…~10.0.26100.9711` CurrentState=112（已安装）佐证 | — |
| WindowsSandbox.exe | 存在，FileVersion **10.0.26100.8875**，mtime 2026-10-20 | 沙盒组件为 **26100（24H2）基线**版本，跑在 26200 系统上；25H2 大量组件保持 26100 基线属正常现象，但值得记录 |
| Store 版客户端 | **无** `Sandbox` 相关 Appx 包；无 `Microsoft.WindowsSandbox*` 包目录 | 见第六节（仅报告，不安装） |
| vGPU 策略 | `HKLM\SOFTWARE\Policies\Microsoft\Windows\Sandbox` **键不存在** → 无策略覆盖 → **默认启用 vGPU** | 首启用的就是默认配置 |
| 关键服务 | vmcompute（Host Compute）/ hns / vmms 均 **Running** | 无服务启动失败 |
| 资源 | 可用内存 14.3 GB / 32.4 GB；C 盘余 576 GB | **排除** 资源不足 |
| GPU | **NVIDIA RTX 3060 Laptop（drv 32.0.16.1742，2026-09-30）** + Intel Iris Xe（drv 32.0.101.6790，2025-04-28） | 混合图形笔记本；dGPU 驱动较新（3 周前） |
| VBS/HVCI | SecurityServicesConfigured=2 / Running=2 / VBSStatus=2 | 按微软枚举约为「启用并运行」；非本错误的已知成因，仅记录 |
| 近期更新 | KB5127648、KB5127690（10-22）、KB5127647（10-20） | 见第四节假设 3 |
| 现存 .wsb | 无（Desktop/Documents/Downloads/Temp 均未找到） | 首启为无配置默认启动 |

⚠️ 甄别说明：诊断快照中的 `sandbox-cli`、`sandbox-center`、`sandbox-cli-gc`、`codex-windows-sandbox-service` 进程是**本会话代理环境自身的沙盒组件**，与 Windows Sandbox 无关，未作为证据采用。

## 三、日志证据（本轮实测）

1. **唯一记录到沙盒 VM 生命周期的通道**：`Microsoft-Windows-Hyper-V-VmSwitch-Operational`。完整时间线见文首表：VM 17:21:42 启动 → 17:24:52 暂停拆除，与错误弹窗时间吻合。
2. **`Hyper-V-Compute-Admin`、`Hyper-V-Worker-Admin`、`Hyper-V-VMMS-Admin`、`Hypervisor-Operational`：自本次开机（16:43）以来 0 条记录**。宿主计算服务未记录任何错误——即宿主机侧看不到失败原因。
3. **`Containers-DisposableClientVM` 系列通道在本机不存在**（wevtutil el 全量枚举证实）。沙盒专属日志通道缺失，客人（guest）内部的失败细节随沙盒销毁，**无法从宿主日志获取**。
4. System / Application 日志中**无** bugcheck、无 Windows Error Reporting 转储、无 Application Error/Hang、无磁盘错误。仅有的噪声（Update Orchestrator 7023、DCOM 10010、CertEnroll SCEP 失败、BitLocker 24641）均与沙盒无关。
5. 沙盒工作目录 `C:\ProgramData\Microsoft\Windows\Containers\ContainerStorages` 存在（元数据正常），无残留沙盒进程。

**结论（日志可证明的部分）**：宿主机健康、资源充足、服务正常、VM 正常创建并运行约 3 分钟后被拆除；失败发生在**客人内部**，宿主侧无错误事件可指认根因。

## 四、0x80072746 原因分析（区分日志证据与社区经验）

**机理**：0x80072746 是 WinSock `WSAECONNRESET`（10054）的 Win32 包装。Windows Sandbox 宿主客户端（WindowsSandbox.exe）通过 VM 总线与客人维持一个类 RDP 会话；17:24:52 客人 VM 被拆除时，该会话对端消失，宿主收到连接重置 → 弹错。**因此 0x80072746 是「客人已死」的结果，不是根因**；真正的根因是「客人为何在约 3 分钟启动过程中黑屏死亡」。

按证据权重排序的假设：

| # | 假设 | 支持证据（日志/实测） | 反对/削弱证据 | 判定 |
|---|---|---|---|---|
| 1 | **GPU-PV（虚拟化 GPU）不兼容**：客人显示栈初始化失败 → 黑屏 → VM 拆除 | 首启 vGPU 为默认启用；混合图形（NVIDIA dGPU + Intel 集显）；「黑屏→连接丢失」组合是该问题的典型签名；本机无任何宿主错误日志佐证其他成因 | 宿主日志无 GPU 相关错误记录；社区经验非本机证明 | **最可能，待 N3 验证** |
| 2 | 首次启动镜像准备/存储路径问题 | 3 分钟运行时长与首启镜像拷贝耗时相符 | 磁盘健康、576 GB 空闲、无存储错误事件；此类失败通常伴随 Compute-Admin 记录（本机为 0） | 可能性低 |
| 3 | 25H2 / 近期累积更新与沙盒组件（26100 基线）的交互 | 沙盒组件为 26100.8875，跑在 26200.9711 上；10-22 刚装两个 KB；社区有同错误与特定 KB 相关的先例（KB5046740，24H2） | 无法归因到本机具体 KB；卸载/验证 KB 属于系统改动，本轮不授权 | 存疑，不作行动依据 |
| 4 | ~~RDP 会话限制~~ / ~~资源不足~~ / ~~入口缺失~~ / ~~客户端更新~~ | — | — | **已排除**（见第二、三节） |
| 5 | VBS/HVCI 启用的干扰 | VBS 状态为启用 | 非该错误的已知成因；且改动需系统权限，本轮不授权 | 仅记录 |

**社区经验（单独标注，非本机结论）**：Microsoft Q&A 多个线程（如 learn.microsoft.com/answers/questions/2123260 及 KB5046740 讨论帖）中，大量用户报告完全相同的「黑屏 → 0x80072746」，其中最高票修复为**禁用 Windows Sandbox 的 vGPU 共享**（组策略「Allow vGPU sharing」= Disable，或注册表 `AllowVGPU=0`，或经 `.wsb` 设置 `VGpu=Disable`）。微软官方文档确认 `.wsb` 的 `VGpu=Disable` 会使沙盒改用软件渲染，且**默认值为启用**。这些公开报告与本机现象签名一致，但不能替代本机验证。

## 五、下一阶段候选：单独 .wsb + `VGpu=Disable`（**本轮未执行，仅评估**）

- **做法**：新建一个只含 `<VGpu>Disable</VGpu>` 的 `.wsb`，双击启动。**这是启动参数，不是系统修改**——不动组策略、不动注册表、不动驱动、不动功能开关；删除文件即完全恢复原状。
- **为何适合本验收**：轻衡是 Tauri/WebView2 应用，9 项验收全是功能点验，不需要 GPU 加速；软件渲染足够，且沙盒的隔离属性（一次性容器、独立临时配置）不变。
- **判定逻辑**：桌面出现 → GPU-PV 路径确认为主因，后续再单独决策是否接受软件渲染继续验收、或另案授权驱动/更新排查；仍黑屏 → 假设 2/3 权重上升，转向退路 D/C 或申请更深层的宿主机排查授权。
- **明确不做（越权项）**：组策略/注册表 `AllowVGPU=0`（属系统修改）、驱动回滚或更新、禁用/重开 Sandbox 功能、DISM 修复、卸载 KB、安装任何 Store 客户端。
- **注意**：与组策略路线相比，`.wsb` 路线零系统改动、可逆、单次生效，是本轮约束下唯一可评估的 vGPU 验证手段。

## 六、客户端更新 / Microsoft Store 检查结论（仅报告）

- 本机**没有** Store 版「Windows Sandbox Client」Appx 包，也没有 `Microsoft.WindowsSandbox*` 包目录——不存在待处理的客户端更新或 Store 相关问题。
- 轻衡沙盒入口用的是系统内置组件 `WindowsSandbox.exe`（10.0.26100.8875），开始菜单入口经你确认存在。
- 按本轮约束：**不安装、不下载、不更新**任何客户端。

## 七、最小风险下一步（待你另行批准）

| 步骤 | 内容 | 风险 | 状态 |
|---|---|---|---|
| N1 | 两轮只读诊断（本报告） | 零 | ✅ 已完成 |
| N2 | 默认配置原样重试一次（先确认无残留 WindowsSandbox 进程） | 零系统改动；仅一次沙盒启动 | 待批准 |
| N3 | 仅含 `VGpu=Disable` 的 `.wsb` 空跑（无文件夹映射、无网络改动） | 零系统改动；可逆 | 待批准 |
| N4 | 桌面恢复后，才扩展 `.wsb`（只读映射候选 MSI + Networking=Disable + 禁剪贴板）并走隔离验收 S1–S6 | MSI 安装需**单独授权** | 待批准 |
| 退路 D | 免安装 exe + 重定向 APPDATA 做功能冒烟（不验证 MSI 安装本身） | 零系统改动 | 备选 |
| 退路 C | 安装 VirtualBox 等完整虚拟机验收 | 需装虚拟化软件，最重 | 备选 |

**停止条件**（任一触发即停并汇报）：任何步骤需要提权或修改系统配置；出现新的错误码或宿主机异常；宿主机快照（`C:\Program Files\轻衡`、`%APPDATA%\cn.fitwise.local`、开始菜单快捷方式）出现任何变化；你叫停。

## 八、证据边界声明

- 日志已证明：VM 起止时刻与错误弹窗吻合；宿主机无错误事件；资源/服务/会话/vGPU 默认状态；混合图形与 dGPU 驱动日期。
- 日志未证明（也无法从宿主证明）：客人内部失败的具体模块；GPU-PV 是否为主因；与近期 KB/驱动的因果关系。客人日志随沙盒销毁，`Containers-DisposableClientVM` 通道本机不存在。
- 本报告所有结论均标注证据类型；社区经验仅作假设排序参考，未当作本机事实。

---

**本轮纪律复述**：只读诊断两轮（脚本与原始输出存于 `%TEMP%\fitwise-sandbox-diag.ps1` / `fitwise-sandbox-diag2.ps1` / `fitwise-sandbox-diag.log`）；未修改任何系统设置；未安装轻衡 MSI；未读取真实数据库；沙盒启动验收记为**失败，待诊断**。
