# 12 — 复盘读取返回逐条分数

**What to build:** `show-decision` 与详情页给出每条 Prediction 的分数，**直接取 `QuestionScore` 已存的值**，不新增计分口径、不做决策级聚合分。

**Blocked by:** 11

**Status:** implemented（验证：`npm run typecheck` / `npm run lint` / `npm test` / `npm run test:e2e` 全部通过。界面那一半自本轮起有断言：`e2e/agent-cli.spec.ts` 断言逐条 `Brier ### · 无相对分` 在复盘页可见——**空 ≠ 0 分**是这条 AC 的要点）

- [x] 每条 Prediction 返回 `absoluteScore` 与 `relativeScore`（非公共事实类为 `null`；未结算则没有分数行，这与"0 分"不是一回事）
- [x] 详情页逐条显示分数，并明说 `null` 不是 0（e2e 断言 `无相对分`）
- [x] 列表页仍只给事实（未新增决策级聚合分——那是一个新指标，归 ADR-0002 管辖）
