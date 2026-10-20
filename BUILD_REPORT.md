# Windows 0.3.0 构建与验证报告

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
| `src-tauri/target/release/fitwise-local.exe` | 7,383,040 | `266C0A0D0BA8D247B28CD1E785A83E4B27A12401395A425E6697F9C6F307AEDF` | 未签名 |
| `src-tauri/target/release/bundle/msi/轻衡_0.3.0_x64_zh-CN.msi` | 4,259,840 | `061E1FAE7B22734615D40E64521B4FB5BFF802493151A70BEB8588DE1A0FCE37` | 未签名 |
| `src-tauri/target/release/bundle/nsis/轻衡_0.3.0_x64-setup.exe` | 3,398,305 | `FE1C97B9BCA6B790C889E7AB07004CBE1C53BC296CC7F0D95C0AA91162BD1553` | 未签名 |

安装包远低于 150 MB 目标；release 主程序远低于 250 MB 目标。

## 自动化验证

- `npm test`：3 个测试文件、12 项测试全部通过。
- `npm run build`：TypeScript 与 Vite 生产构建通过。
- `cargo test`：7 项测试全部通过。
  - 领域状态拆分为单例/实体并往返恢复。
  - 事务开始后的重复主键错误会完整回滚，修订号不增加。
  - `app_kv v3` 旧状态导入成功，并保留旧值作为回退源。
  - AES-GCM 加密往返与错误口令拒绝。
  - SQLite 在线快照、加密、解密和完整性恢复。
  - 下次启动恢复、安全副本与失败回滚。
  - Windows Credential Manager 临时写入、读取和删除。
- release 构建成功生成 MSI 与 NSIS 两种安装器。

## 0.3 数据层结果

- SQLite migration v3 建立 `domain_singletons`、`domain_entities`、`domain_state_meta`。
- Tauri 桌面版不再由前端直接写 `app_kv`，所有新状态写入均通过 Rust 命令。
- 14 类集合按稳定实体标识保存，单例与集合在同一 SQLite 事务中替换。
- 每次成功写入增加单调修订号并保存完整输入 SHA-256；非法状态、缺少稳定标识和重复实体会回滚。
- 首次读取找不到新仓库时才从旧 `app_kv` 导入；导入成功前不会暴露半迁移状态。
- 设置页显示仓库是否初始化、当前修订和实体数量。

当前边界：前端仍提交完整 Zustand 快照，Rust 再拆分保存；`payload_json` 是实体级 JSON。逐操作命令、幂等键、字段化查询投影和专用表接管将在 0.3.1 完成。

## 安装与原生 UI 验证

- 0.3.0 MSI/NSIS 均成功生成。
- 旧 0.2.1 是系统级安装；静默 `RemoveExistingProducts` 子流程因管理员令牌丢失返回 Windows Installer 错误 1730/1603。
- 使用已确认产品代码显式管理员卸载 0.2.1 后，0.3.0 MSI 安装退出码为 0；用户数据目录未作为卸载目标。
- 已安装文件 `C:\Program Files\轻衡\fitwise-local.exe` 的 FileVersion/ProductVersion 均为 0.3.0。
- 通过 Windows 原生窗口捕获逐一检查今日、饮食、运动、库存、计划、趋势、收件箱、AI 助手、设置共 9 页；主内容均可见，未出现右侧空白或错误兜底。
- 设置页成功调用 Rust 仓库状态接口。当前显示“等待首次写入”，因为验收未擅自修改用户记录；事务写入、迁移和往返由隔离测试覆盖。

## 资源口径

- 安装版主进程工作集约 44.4 MB，私有内存约 13.8 MB。
- 本轮环境拒绝读取完整进程父子关系，因此没有把共享 WebView2 子进程相加后宣称为正式总量。
- 0.2.1 固定场景下完整进程树私有提交约 242.3 MB；0.3.0 仅增加轻量 Rust 仓库代码，仍需在后续性能基准中重新测量完整进程树和普通操作峰值。

## 已知边界

- 安装包未代码签名，Windows 会显示未知发布者。
- MSI 的跨版本静默升级路径需要在 0.3.1 修复，避免旧版嵌套卸载的管理员令牌问题。
- 当前加密备份只覆盖 SQLite 数据库，尚未打包原始附件。
- 自动日备份、周备份和保留轮换尚未启用。
- AI Provider 配置、凭据和费用边界已实现，但真实模型请求保持关闭。
- 图片隐私处理目前只提示人工检查，尚未实际遮挡头像、昵称、二维码、订单号或地址。
- MCP/CLI 按计划后置到首版后的第一个小版本。
