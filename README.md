# 轻衡 · Fitwise Local

本地优先的个人减脂、饮食、体重、运动、采购与食材库存管理应用。

## 当前实现

- 今日仪表盘：热量、蛋白质、纤维、体重趋势、主观状态与完成日。
- 饮食日记：三态营养值、营养覆盖率、标准菜谱和整锅消费比例。
- 熟食批次：制作只扣一次原料，午晚餐按实际比例分别计入，剩余与浪费独立记录。
- 库存与采购：采购/收货分离、FEFO 扣减、临期和剩余成本。
- 次日计划：三个候选方案、库存覆盖、缺货和后两日预演。
- 运动：手工记录、热量独立展示、来源指纹去重模型。
- 收件箱：Tauri 桌面版十分钟局域网二维码上传，附件只进入待确认区。
- 趋势：完整日热量均值、七日体重移动平均。
- 本地持久化：浏览器开发模式使用 localStorage；Tauri 通过 Rust 事务仓库把状态拆分为 SQLite 单例和 14 类领域实体。
- SQLite v3 保存仓库修订与内容哈希，支持旧 `app_kv` 自动导入及失败回滚；逐操作领域命令将在下一阶段接管。
- 数据库加密备份：Argon2id 派生密钥、AES-256-GCM 认证加密、创建后立即恢复验证。
- 安全恢复：先暂存与复检，下次启动前保留当前数据库安全副本，失败自动回滚。
- AI 配置边界：可替换提供商、Windows 凭据存储、月度费用软上限与手工降级。
- 本地隐私预览：文本常见标识遮挡；图片未实际处理时明确要求人工复核。

真实 AI 网络请求、附件随备份打包、自动备份轮换、MCP/CLI 和截图视觉识别尚未开放，不会伪装成已配置服务。

## Web 开发预览

```powershell
npm install
npm run dev
```

访问 `http://localhost:1420`。浏览器预览无法启动 Tauri 局域网上传服务，其余核心交互可用。

## 检查

```powershell
npm test
npm run build
```

## Windows 桌面版

本机已经验证以下最小工具链，不需要完整 Visual Studio IDE：

- Visual Studio Code
- Rust stable x86_64-pc-windows-msvc
- Microsoft Visual Studio 2022 Build Tools（VCTools workload）
- Windows SDK 10.0.26100.0
- WebView2 Runtime

安装工具链后执行：

```powershell
npm run tauri dev
npm run tauri build
```

生产构建输出 MSI 与 NSIS 安装包。应用本体不捆绑本地大模型。

最新的安装包、哈希、内存口径和安装/卸载验证见 [BUILD_REPORT.md](./BUILD_REPORT.md)。

## 数据安全

- 正式数据只由用户确认写入。
- 手机上传会话随机、短时、仅允许私有 IPv4 局域网。
- 外部助手不得直接访问 SQLite。
- AI API Key 只进入 Windows Credential Manager，不写入 SQLite 或 JSON 导出。
- 忘记备份口令后无法解密，应用不会保存或找回口令。
- 不把未知营养值当作零。
- 同日体重修订保留原记录和审计链，不静默覆盖。
- 运动消耗不抵扣饮食目标。
- 本产品不是医疗器械，不提供诊断或治疗建议。
