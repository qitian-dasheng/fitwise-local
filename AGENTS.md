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
