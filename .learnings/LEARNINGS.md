# Learnings

Corrections, insights, and knowledge gaps captured during development.

**Categories**: correction | insight | knowledge_gap | best_practice

---
## [LRN-20261022-001] correction

**Logged**: 2026-10-22T19:40:00+08:00
**Priority**: medium
**Status**: pending
**Area**: docs

### Summary
点验/操作步骤必须引用界面原文标签，不能用内部术语，否则用户在 UI 里找不到对应控件。

### Details
0.7.0 点验时步骤写「计量状态」（measurementBasis 的内部直译），实际界面标签是「食物状态」（LabelDrafts.tsx），用户回复「没有计量状态」造成一次往返。同类：把「换算预览」说成表单中途可见的校验（实际拦截发生在确认时）。

### Suggested Action
写点验清单/操作指引前，先 Read 对应 tsx 抄界面原文标签；同一概念在多个表单出现时先确认各处标签是否一致（本次两处不一致本身也是缺陷，M4 已统一为「食物状态」）。

### Metadata
- Source: user_feedback
- Related Files: src/components/LabelDrafts.tsx, src/components/FoodLibraryModal.tsx
- Tags: 点验, 文档, 用词
- Pattern-Key: docs.use-ui-labels-not-internal-terms
- Recurrence-Count: 1
- First-Seen: 2026-10-22
- Last-Seen: 2026-10-22

---
