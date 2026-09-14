# 01 — 决策可创建，叙事可回看

**What to build:** 一个人（或 Agent）能创建一个 Decision，写下决策陈述与理由 / 预期后果 / 当时已知 / 当时未知，并能在它的页面上回看这些内容。不挂任何 Prediction 的决策也是合法状态。

**Blocked by:** None — can start immediately.

**Status:** implemented（验证：`npm run typecheck` / `npm run lint` / `npm test` / `npm run test:e2e` 全部通过；详情页已由 e2e 实跑，见 ticket 06）

- [x] 能创建 Decision：`statement` 必填，其余叙事字段可空
- [x] 空白或纯空格的 `statement` 被拒绝（seam S1 与 S2 各有一条测试）
- [x] 能按 id 读回叙事；不存在或非本人拥有的 id 被拒绝（同一答案，不泄露存在性）
- [x] 一个 Decision 可以没有任何 Prediction（schema 上无必填关系）
- [x] 决策详情页显示这些叙事字段（`pages/decisions/[id].tsx`）
- [ ] 能**修改**叙事（CLI `update-narrative`）：给空白字段补写自由；**改写已填写内容必须带理由并留痕**（ADR-0012，复用 `Revision`）
- [x] 不挂 Decision 的既有 Question 行为零回归（迁移纯 additive，全量测试通过）
