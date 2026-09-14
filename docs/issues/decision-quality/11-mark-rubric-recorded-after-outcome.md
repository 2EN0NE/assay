# 11 — "结果揭晓后记录"的标记

**What to build:** 唯一剩下的绕过路径——先建决策、补满清单、再把一条**已经结算**的 Prediction 挂上来——在复盘时被标出来，不再与"当初填的"同形。

**Blocked by:** 09

**Status:** implemented（验证：`npm run typecheck` / `npm run lint` / `npm test` 全绿；迁移 `20260913143718_decision_rubric_recorded_after_outcome`。详情页那一处展示自本轮起有断言：`e2e/agent-cli.spec.ts` 先结算再补清单再挂载，断言复盘页出现「这份清单是在**结果揭晓之后**记录的」）

- [x] `Decision.rubricRecordedAfterOutcomeAt`：挂载已结算预测时，若该决策存在"记录时点晚于该预测揭晓时点"的清单条目，记下这些条目中**最早**的记录时点
- [x] 正常路径（先挂、后结算）不产生标记——那时的清单确实是决策当时写的
- [x] 详情页与 `show-decision` 都展示这个标记，并说明它的含义（而不是只给一个时间戳；详情页由 e2e 断言）
