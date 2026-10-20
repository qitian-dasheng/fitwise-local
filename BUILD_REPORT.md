# Windows 0.3.1 构建与验证报告

生成日期：2026-10-20（Asia/Shanghai）

## 工具链

- Visual Studio Code 1.141.2。
- Visual Studio 2022 Build Tools 17.14.42，仅安装 VCTools workload；未安装完整 Visual Studio IDE。
- MSVC 19.44.35229、Windows SDK 10.0.26100.0、CMake 3.31.6-msvc6。
- Rust 1.99.1 stable，目标 `x86_64-pc-windows-msvc`。
- WebView2 Runtime 155.0.4283.62。

## 产物

| 产物 | 字节 | SHA-256 | 签名 |
| --- | ---: | --- | --- |
| `C:\Program Files\轻衡\fitwise-local.exe` | 7,452,672 | `1DF6D68AA71D317DEAFB8BE93562FD5C3063309FFCD72499563270649810E081` | 未签名 |
| `src-tauri/target/release/bundle/msi/轻衡_0.3.1_x64_zh-CN.msi` | 4,292,608 | `DFC1C669761CCE795437EFE29BA4A214BD966FCE6DB1055F98BAA15D231A5F98` | 未签名 |
| `src-tauri/target/release/bundle/nsis/轻衡_0.3.1_x64-setup.exe` | 3,423,825 | `E59E53B5FAC859F0DEC0995BA12DCB3B41729A932CFC6A9637F929FA576B48CC` | 未签名 |

安装包远低于 150 MB 目标；release 主程序远低于 250 MB 目标。

## 自动化验证

- `npm test`：3 个测试文件、12 项测试全部通过。
- `npm run build`：TypeScript 与 Vite 生产构建通过。
- `cargo test`：11 项测试全部通过。
  - 领域状态拆分为单例/实体并往返恢复。
  - 事务开始后的重复主键错误会完整回滚，修订号不增加。
  - `app_kv v3` 旧状态导入成功，并保留旧值作为回退源。
  - AES-GCM 加密往返与错误口令拒绝。
  - SQLite 在线快照、加密、解密和完整性恢复。
  - 下次启动恢复、安全副本与失败回滚。
  - Windows Credential Manager 临时写入、读取和删除。
  - 制作命令重复提交只扣一次库存；进食 75% 后丢弃余量保持比例守恒。
  - 超额进食在事务内失败且不增加修订；收货和库存调整重复提交不重复生效。
- release 构建成功生成 MSI 与 NSIS 两种安装器。

## 0.3.1 数据层结果

- SQLite migration v3 建立 `domain_singletons`、`domain_entities`、`domain_state_meta`。
- Tauri 桌面版不再由前端直接写 `app_kv`，所有新状态写入均通过 Rust 命令。
- 14 类集合按稳定实体标识保存，单例与集合在同一 SQLite 事务中替换。
- 每次成功写入增加单调修订号并保存完整输入 SHA-256；非法状态、缺少稳定标识和重复实体会回滚。
- 首次读取找不到新仓库时才从旧 `app_kv` 导入；导入成功前不会暴露半迁移状态。
- 设置页显示仓库是否初始化、当前修订和实体数量。
- SQLite migration v4 建立 `domain_command_receipts`，命令结果、应用修订和创建时间随事务保存。
- 制作、进食、丢弃、收货和库存调整已改用 Rust 领域命令；FEFO、比例校验、守恒和审计在后端确定性执行。
- UI 在命令执行时锁定重复操作；失败重试沿用原 `commandId`，成功后才更新前端状态。

当前边界：其余写入仍提交完整 Zustand 快照；`payload_json` 仍是实体级 JSON，页面读取仍主要来自内存镜像。字段化查询投影和剩余命令将在 0.3.2 接管。

## 安装与原生 UI 验证

- 0.3.1 MSI/NSIS 均成功生成。
- 使用管理员权限从已安装 0.3.0 直接运行 0.3.1 MSI，退出码为 0；不需要先卸载旧版。
- 已安装文件 `C:\Program Files\轻衡\fitwise-local.exe` 的 FileVersion/ProductVersion 均为 0.3.1。
- 饮食、库存和设置三个本轮受影响页面通过 Windows 原生窗口复验；主内容可见，未出现右侧空白或错误兜底。
- 设置页成功查询 v4 仓库状态并显示“实体 / 命令 / 审计”。当前仍为“等待首次写入”，因为验收未擅自修改用户正式记录。

## 资源口径

- 安装版在库存页静置时主进程工作集约 30.7 MB，私有内存约 6.5 MB。
- 本轮环境拒绝读取完整进程父子关系，因此没有把共享 WebView2 子进程相加后宣称为正式总量。
- 0.2.1 固定场景下完整进程树私有提交约 242.3 MB；0.3.1 仍需在固定脚本下重新测量完整 WebView2 进程树和普通操作峰值。

## 已知边界

- 安装包未代码签名，Windows 会显示未知发布者。
- 管理员覆盖升级已通过；普通交互 UAC、非管理员账户和跨机器安装矩阵尚未完整验证。
- 当前加密备份只覆盖 SQLite 数据库，尚未打包原始附件。
- 自动日备份、周备份和保留轮换尚未启用。
- AI Provider 配置、凭据和费用边界已实现，但真实模型请求保持关闭。
- 图片隐私处理目前只提示人工检查，尚未实际遮挡头像、昵称、二维码、订单号或地址。
- MCP/CLI 按计划后置到首版后的第一个小版本。
