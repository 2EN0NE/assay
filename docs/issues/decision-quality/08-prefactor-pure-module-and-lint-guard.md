# 08 — prefactor：纯模块归位 + 架构守卫换成 lint

**What to build:** 无行为变化的内聚修整，为后面几个切片让路：把"锁定态"与"某条目的完成状态"的判定搬进纯领域模块，让路由与页面共用同一份；把"决策质量分不得读结算结果"的守卫从自研源码文本断言换成 ESLint 的 `no-restricted-imports`。

**Blocked by:** None — can start immediately.

**Status:** implemented（验证：`npm run typecheck` / `npm run lint` / `npm test` 全绿；ESLint 守卫已按 AC 做一次性验证——往 `lib/_scoring.ts` 临时加一行违规 import，`npm run lint` 报 `no-restricted-imports`，随后删除）

- [x] 锁定态判定（`lockOf`）与"某条目的完成状态"（`statusOf`）都在 `decision_rubric.ts` 里，路由与页面各只有一处调用
- [x] `agent_router` 创建预测时复用 `decision_router` 的属主校验，不再各写一份
- [x] 删除 `lib/web/decision_decoupling.test.ts`（自研文本断言：会命中注释、会漏 barrel、且是 S1–S4 之外的新 seam），改为 ESLint `no-restricted-imports`
- [x] **一次性验证**：临时在 `lib/_scoring.ts` 加一行违规 import，`npm run lint` 必须报错；随后删除该行
- [x] `npm run typecheck` / `npm run lint` / `npm test` 全绿，且无行为变化
