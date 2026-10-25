# Agent instructions for 轻衡

Before any task, read `START_HERE.md` completely, then inspect Git status and actual code. START_HERE is the single authoritative handoff document (problem ledger included); release records live in `docs/releases/`, historical phase docs in `docs/history/`. Chat summaries and older documents may be stale.

- Work in Chinese unless the user requests otherwise.
- Preserve user data and unrelated changes. Never inspect, modify, copy, commit, upload, or use `build-logs/data-rescue`, AppData databases, exports, attachments, screenshots, health details, order details, or credentials as test data.
- Do not launch the production app from shell or automation launch helpers for persistence verification. Use the user's normal Windows/Explorer entry and distinguish it from browser/development storage.
- Production writes go through Rust domain services and SQLite transactions. Do not expose direct SQLite access to the frontend or external agents.
- Unknown nutrition is not zero. History uses immutable versions/snapshots. Corrections create auditable revisions or voids.
- Do not install software/dependencies, perform real-data recovery/merge/backfill/delete/reset, or overwrite-install a build without explicit user approval.
- Keep VS Code; do not install the full Visual Studio IDE.
- For every phase: implement, critique the result, fix/regress, verify in an isolated database, verify the installed app when authorized, then update START_HERE and the next plan.
- Do not claim an unrun test, build, install, UI action, or planned feature as complete. Link evidence in the release record under `docs/releases/`.
- Built-in AI is not the current product mainline. Core operation must remain fully manual/offline. External agents may later receive only read summaries and draft-creation interfaces.
- **文档纪律**：不新建根目录文档（守卫测试冻结上限）；开发过程中只更新现有文档；每个版本发布时只做三件事——`docs/releases/vX.Y.Z.md` 一份记录、刷新 START_HERE 的「当前事实」、DAILY_USAGE 在用户可见行为变化时更新。新文档须用户批准且放 `docs/` 下。
- **分级门禁（0.9.3 起）**：A 前端小修 = vitest+tsc+浏览器截图自验（UI 改动必做），不跑 cargo；B 涉 Rust = A + clippy + cargo test（全量 105 到发布前）；C 发布候选 = 全量门禁 + fmt + 构建 + 文档批量同步。NSIS 只在发布轮构建；验收轮只建主分发件。UI 抛光冻结：将被驾驶舱迁移替换的页面只修 bug 不美化，不为其新增深度 UI 测试。
- **更新包构建与发布（0.9.3 起）**：签名密钥在本机 `~/.fitwise/updater-keys/`（私钥+密码+公钥；**绝不入库**，备份指引见该目录）。构建更新包需设 `TAURI_SIGNING_PRIVATE_KEY`（**打包签名用这个**，值为私钥路径或内容；`_PATH` 变体只对 `tauri signer sign` 生效——2026-10-25 实测踩坑）与 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`（读密码文件），`npm run tauri build` 产出 NSIS exe + `.sig`；`node scripts/make-update-manifest.mjs <版本>` 生成 `latest.json`；Release 上传三件套（ASCII 名 exe、.sig、latest.json），GitHub 禁止同名资产覆盖、先删旧再传。更新检查是应用唯一网络行为，改动静默检查默认值须同步 README 隐私声明。
