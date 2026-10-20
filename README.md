# 轻衡 · Fitwise Local

本地优先的个人减脂、饮食、体重、运动、采购与食材库存管理应用。

## 当前实现

- 今日仪表盘：热量、蛋白质、纤维、体重趋势、主观状态与完成日。
- 饮食日记：三态营养值、营养覆盖率、标准菜谱和整锅消费比例。
- 库存与采购：采购/收货分离、FEFO 扣减、临期和剩余成本。
- 次日计划：三个候选方案、库存覆盖、缺货和后两日预演。
- 运动：手工记录、热量独立展示、来源指纹去重模型。
- 收件箱：Tauri 桌面版十分钟局域网二维码上传，附件只进入待确认区。
- 趋势：完整日热量均值、七日体重移动平均。
- 本地持久化：浏览器开发模式使用 localStorage，Tauri 使用 SQLite。
- SQLite 规范化 schema、审计、授权和外部助手所需领域边界。

AI 提供商、加密备份、MCP/CLI 和截图视觉识别已保留边界，但不会伪装成已配置服务。

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

需要：

- Rust stable（MSVC toolchain）
- Microsoft Visual Studio C++ Build Tools / Windows SDK
- WebView2 Runtime

安装工具链后执行：

```powershell
npm run tauri dev
npm run tauri build
```

生产构建输出 MSI 与 NSIS 安装包。应用本体不捆绑本地大模型。

## 数据安全

- 正式数据只由用户确认写入。
- 手机上传会话随机、短时、仅允许私有 IPv4 局域网。
- 外部助手不得直接访问 SQLite。
- 不把未知营养值当作零。
- 运动消耗不抵扣饮食目标。
- 本产品不是医疗器械，不提供诊断或治疗建议。
