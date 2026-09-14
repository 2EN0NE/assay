# 13 — 叙事的写入口与留痕

**What to build:** CLI `update-narrative` 成为叙事的唯一写入入口：给**空白字段补写自由**；**改写（或清空）已填写内容必须带理由并落一条修订**。`Revision` 因此同时承载 Question 的冻结字段与 Decision 的叙事字段。

**Blocked by:** 09

**Status:** implemented（验证：`npm run typecheck` / `npm run lint` / `npm test` 全绿；迁移 `20260913144100_revision_subject_question_or_decision`；CHECK 约束用真库探针实测——无主体与双主体两种写法都被数据库以 23514 拒绝）

- [x] 给空白字段补写不产生修订、不需要理由
- [x] 改写或清空已填写内容必须带 `--reason`，否则拒绝（且什么都不写）
- [x] 产生修订时，快照 → 留痕 → 更新**同事务**；`Revision` 行含旧值 / 新值 / 理由，主体用 `questionId` / `decisionId` 二者恰有其一表达（迁移里有 CHECK 约束）
- [x] 局部更新：未提及的字段保持原值，不被清空
- [x] 修订记录可被回看（至少一处入口：CLI 或界面）
