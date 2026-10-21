# Agent instructions for 轻衡

Before any task, read `START_HERE.md`, `PROJECT_MEMORY.md`, and `FINAL_PRODUCT_PLAN.md` completely, then inspect Git status and actual code. These files are the shared project memory; chat summaries and older phase documents may be stale.

- Work in Chinese unless the user requests otherwise.
- Preserve user data and unrelated changes. Never inspect, modify, copy, commit, upload, or use `build-logs/data-rescue`, AppData databases, exports, attachments, screenshots, health details, order details, or credentials as test data.
- Do not launch the production app from shell or automation launch helpers for persistence verification. Use the user's normal Windows/Explorer entry and distinguish it from browser/development storage.
- Production writes go through Rust domain services and SQLite transactions. Do not expose direct SQLite access to the frontend or external agents.
- Unknown nutrition is not zero. History uses immutable versions/snapshots. Corrections create auditable revisions or voids.
- Do not install software/dependencies, perform real-data recovery/merge/backfill/delete/reset, or overwrite-install a build without explicit user approval.
- Keep VS Code; do not install the full Visual Studio IDE.
- For every phase: implement, critique the result, fix/regress, verify in an isolated database, verify the installed app when authorized, then update project memory and the next plan.
- Do not claim an unrun test, build, install, UI action, or planned feature as complete. Link evidence in `BUILD_REPORT.md` and the relevant `REVIEW_*.md`.
- Built-in AI is not the current product mainline. Core operation must remain fully manual/offline. External agents may later receive only read summaries and draft-creation interfaces.
