# 轻衡 · Fitwise Local

Windows 本地优先的个人营养 / 饮食 / 体重 / 运动记录桌面应用。**无账号、无云端、无遥测**，所有记录只存在本机 SQLite。

当前版本 **0.11.0**。技术栈：Tauri 2 + React 19 + TypeScript + Rust + SQLite。

---

## 0.11.0 有什么

### 内置食材目录（235 项，开箱即用）

- 覆盖八大类：主食谷物 / 蛋奶 / 畜禽肉 / 水产 / 豆制品 / 蔬菜 / 水果 / 油脂调味，每类 26–35 项。
- 数据来自 USDA FoodData Central **SR Legacy**（公有领域），统一为每 100 克**可食部**口径；每条带 `sourceRef`（库名 + FDC 编号 + 英文原名），可在条目上查看出处。
- 数值一律取自数据原文，缺失项标「未知」，**不做任何推算**。
- 目录食材可直接使用；修改会生成**个人副本**（原条目保留）；删除后升级不会复活。

### AI 采集通道（可选，默认关闭）

- 设置 → AI 采集：连接本机 Ollama（默认 `localhost:11434`），可从已装模型中选择。
- 饮食页「AI 描述」：一句话描述这餐 → 生成可编辑的营养草稿 → 人工核对后加入待确认篮子 → 确认才入账。
- 草稿营养标 `ai_estimate`、置信度 low，**永不直接入账**；草稿不持久化，关窗即弃。

### 更新器

- 代理模式「跟随系统代理（默认）/ 直连」，手动检查与启动静默检查同源。
- 静默检查失败时，今日页出现一次性提示条；失败详情可一键复制。
- 官方 GitHub 端点失败后按序尝试社区加速镜像（ghfast），下载由 minisign 验签保护，镜像只能影响可用性、不能篡改内容。

---

## 安装与升级

- **0.10.0 → 0.11.0**：应用内自动更新（设置 → 关于与更新 → 检查更新）。注意 0.10.0 客户端只认官方端点（镜像随 0.11.0 才生效），若因网络失败请从 Release 手动下载 exe。
- **0.9.x → 0.11.0**：从 Release 下载 exe 安装；0.9.2 的 MSI 需先在「设置 → 应用」卸载（卸载不会删除记录数据）。
- 升级前建议冷备份 `%APPDATA%\cn.fitwise.local\` 整目录，**应用须完全退出**（WAL 模式下运行中拷贝会丢最后几条记录）。

---

## 隐私

- **外网仅用于更新检查；AI 采集只连接本机 Ollama**，不向任何外部服务发送记录内容。
- 无账号体系、无遥测、无第三方统计。
- 数据只存在本机：`%APPDATA%\cn.fitwise.local\fitwise.db`。

---

## 数据原则

- **未知营养不是 0**：三态为「未知 / 明确为 0 / 非零」，UI 显示「未知」或「≥已知小计」。
- 食材营养规格不可变版本化；历史记录固定当时的版本与快照，修订资料**不回写**历史摄入。
- 更正与作废保留原值、原因与审计链，不硬删除；已被引用的食材不可级联删除。
- 所有写入走 Rust 领域命令 + SQLite 事务 + 请求指纹 + 幂等回执，前端不直接执行 SQL。
- 运动消耗**不**抵扣饮食目标。

---

## 开发

```bash
npm install
npm run dev          # 浏览器预览。注意 1420 落在 Windows 保留端口段 1344-1443，本机必然绑定失败；
                     # 改用 npx vite --host 127.0.0.1 --port 5173
npm run test         # vitest（含 docsGuard / designGuard / stylesGuard 守卫）
npx tsc -b
cd src-tauri && cargo test
npm run tauri build  # 发布轮构建（需签名私钥，见 AGENTS.md）
```

接手本项目请先读 [START_HERE.md](START_HERE.md)；版本规划见 [docs/ROADMAP.md](docs/ROADMAP.md)；本版发布记录见 [docs/releases/v0.11.0.md](docs/releases/v0.11.0.md)；日常用法见 [DAILY_USAGE.md](DAILY_USAGE.md)。

---

## 许可

MIT License。随包字体等第三方组件的声明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
