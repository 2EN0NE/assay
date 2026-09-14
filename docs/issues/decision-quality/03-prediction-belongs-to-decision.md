# 03 — Prediction 归属 Decision

**What to build:** 能把一条（新建或已有的）Prediction 挂到一个 Decision 上，并在决策页看到它；也能解绑。一条 Prediction 至多归属一个 Decision。

**Blocked by:** 01

**Status:** implemented（验证：`npm run typecheck` / `npm run lint` / `npm test` / `npm run test:e2e` 全部通过；删除语义为**数据库级行为**，已由真库 e2e（`e2e/decision-container.spec.ts`）回归，不假装单测覆盖了它）

- [x] 创建 Question 时可直接指定所属 Decision（越权在落库前就拒）
- [x] 可把一条已有 Question 挂到某个 Decision 上
- [x] 一条 Question 归属两个 Decision 被拒绝，不产生重复归属（重挂同一个决策则幂等）
- [x] 决策页列出挂着的 Prediction 及其结算状态
- [x] 非本人拥有的 Question 不能被挂到自己的决策上（属主写进查询条件）
- [x] 删除 Decision 时挂着的 Question 被保留（外键置空）——**实测**：建决策→挂预测→删决策，预测存活且 `decisionId` 为 `null`
- [x] 既有不挂 Decision 的 Question 零回归（迁移纯 additive）
- [x] 额外的：可解绑（置空归属，而不是删掉预测）
- [ ] CLI 侧与 `attach-prediction` 对称的 `detach-prediction`（现在解绑只有 tRPC 可达：CLI 与界面都没有入口）
