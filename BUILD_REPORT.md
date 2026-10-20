# Windows 0.1.1 构建与验证报告

生成日期：2026-10-20（Asia/Shanghai）

## 工具链

- Visual Studio Code 1.141.2。
- Visual Studio 2022 Build Tools 17.14.42，仅安装 VCTools workload；未安装完整 Visual Studio IDE。
- MSVC 19.44.35229、linker 14.44.35229。
- Windows SDK 10.0.26100.0。
- CMake 3.31.6-msvc6。
- Rust 1.99.1 stable，目标 `x86_64-pc-windows-msvc`。
- WebView2 Runtime 155.0.4283.62。

## 产物

| 产物 | 大小 | SHA-256 | 签名 |
| --- | ---: | --- | --- |
| `src-tauri/target/release/fitwise-local.exe` | 7.00 MiB | `6333BF17F02DCA9B567926FF123CC5BC01FC8953E49AA494A35423AB2034AE69` | 未签名 |
| `src-tauri/target/release/bundle/msi/轻衡_0.1.1_x64_zh-CN.msi` | 4.04 MiB | `437FAAB6C7DFDB5AF1F3B5491C777C9D5776750CEF746BEB0D8712131B0E91B6` | 未签名 |
| `src-tauri/target/release/bundle/nsis/轻衡_0.1.1_x64-setup.exe` | 3.22 MiB | `856A6CD54A83FE9BF5AE01F1871B8FD717CB3619B025961AE0C9AB290861FEA1` | 未签名 |

安装包远低于 150 MB 目标；release 主程序远低于 250 MB 目标。

## 自动化与运行验证

- `npm test`：2 个测试文件、7 项测试全部通过。
- `npm run build`：通过。
- `cargo check`：通过，无警告。
- `cargo test`：4 项测试全部通过。
  - AES-GCM 加密往返与错误口令拒绝。
  - SQLite 在线快照、加密、解密和完整性恢复。
  - 下次启动恢复、安全副本与切换。
  - Windows Credential Manager 临时写入、读取和删除。
- release 端到端备份命令：对真实用户 SQLite 创建 168,285 字节临时加密备份，立即恢复校验返回 `integrity = ok`；错误口令被拒绝为“口令错误或文件损坏”；临时文件随后删除。
- 0.1.0 曾出现真实空白主区。根因是固定定位侧栏与 CSS Grid 混用，WebView2 将主区放进被侧栏覆盖的 222 px 第一列。此前只检查 DOM、未检查像素可见性的验收结论作废。
- 0.1.1 改为固定侧栏加显式主区边距；安装版主区实测 `x = 222`、宽约 `1122.7` CSS px，并通过原生窗口截图确认可见。
- 今日、饮食、运动、库存、计划、趋势、收件箱、AI 助手和设置共 9 个页面逐一加载；均有可见尺寸、正文内容且未触发错误兜底。
- 移除了默认访问 Google Fonts 的外部请求，字体改用 Windows 系统字体；页面异常会显示可恢复错误页，不再静默呈现空白。
- 手机上传服务由监听 `0.0.0.0` 改为只监听启动时选中的私有 IPv4 网卡地址。

## 安装生命周期

- MSI 将已安装的 0.1.0 覆盖升级到 0.1.1，退出码为 0，注册表版本为 0.1.1。
- 升级前后用户数据库 SHA-256 均为 `3938370E39F642016F12C30B5773BA2190DF590C80051B6ABD1A79BEAA7450EC`。
- `C:\Program Files\轻衡\fitwise-local.exe` 升级后正常启动，原生窗口主内容可见。
- 0.1.0 阶段已验证 NSIS 静默安装与卸载、安装目录移除及用户数据库保留；0.1.1 本轮重点验证覆盖升级。

## 资源口径

release 空闲时的完整进程树包含 1 个主进程与 6 个 WebView2 子进程：

- 私有提交合计约 242.3 MB，符合空闲不超过 250 MB 的目标。
- 工作集合计约 486.9 MB；该口径会在多个 WebView2 进程间重复统计共享页面，不与私有提交混用。
- 主进程自身工作集约 30 MB。

后续应使用固定场景和 Windows Performance Recorder 进行正式资源基准，尤其复核“普通操作不超过 450 MB”的统一统计口径。

## 已知边界

- 安装包未代码签名。
- 规范化 SQLite 表已迁移创建，但当前前端业务状态仍整体存于 `app_kv` JSON；规范化表尚未成为唯一事实来源。
- 当前加密备份只覆盖 SQLite 数据库，尚未打包原始附件。
- 自动日备份、周备份和保留轮换尚未启用。
- AI Provider 配置、凭据和费用边界已实现，但真实模型请求保持关闭。
- 图片隐私处理目前只提示人工检查，尚未实际遮挡头像、昵称、二维码、订单号或地址。
- MCP/CLI 按计划后置到首版后的第一个小版本。
