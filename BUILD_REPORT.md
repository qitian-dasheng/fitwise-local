# Windows 构建与验证报告

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
| `src-tauri/target/release/fitwise-local.exe` | 7.00 MiB | `2376A56FBBBE3BC52A9FC1CC3F65DA9605F119C3F4D80DCC11B97A579B192CD0` | 未签名 |
| `src-tauri/target/release/bundle/msi/轻衡_0.1.0_x64_zh-CN.msi` | 4.04 MiB | `203266D39532A5F4FACB72F893B71834199ECDCF2EFC1D9A5BBCB444B3DBD4E1` | 未签名 |
| `src-tauri/target/release/bundle/nsis/轻衡_0.1.0_x64-setup.exe` | 3.22 MiB | `E65BF8A281BF8E373A82517E1E678913BD9CBC2DA43021611E35ABADCC2EF357` | 未签名 |

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
- release 桌面版通过 WebView2 DevTools 协议确认主界面和新版设置页 DOM 完整。
- Windows 截图自动化对 WebView2 主内容层有合成缺失，但直接 DOM 与本地浏览器可访问性树均确认内容已渲染；没有把空白截图误判为应用空白。

## 安装生命周期

- NSIS 静默安装退出码：0。
- 安装版启动成功，窗口标题为“轻衡 · AI 减脂管理”。
- NSIS 静默卸载退出码：0。
- 卸载后安装目录已删除。
- 用户数据库卸载前后 SHA-256 一致：`3938370E39F642016F12C30B5773BA2190DF590C80051B6ABD1A79BEAA7450EC`。

## 资源口径

release 空闲时的完整进程树包含 1 个主进程与 6 个 WebView2 子进程：

- 私有提交合计约 242.3 MB，符合空闲不超过 250 MB 的目标。
- 工作集合计约 486.9 MB；该口径会在多个 WebView2 进程间重复统计共享页面，不与私有提交混用。
- 主进程自身工作集约 30 MB。

后续应使用固定场景和 Windows Performance Recorder 进行正式资源基准，尤其复核“普通操作不超过 450 MB”的统一统计口径。

## 已知边界

- 安装包未代码签名。
- 当前加密备份只覆盖 SQLite 数据库，尚未打包原始附件。
- 自动日备份、周备份和保留轮换尚未启用。
- AI Provider 配置、凭据和费用边界已实现，但真实模型请求保持关闭。
- MCP/CLI 按计划后置到首版后的第一个小版本。
