# 04 — 结算后清单锁定

**What to build:** 决策下任一 Prediction 一经结算，该决策的清单即变为只读，此后再写清单被拒绝。这是"清单在决策当时填写"的可执行化，也是 Resulting 的结构性防线。

**Blocked by:** 02, 03

**Status:** implemented（验证：`npm run typecheck` / `npm run lint` / `npm test` / `npm run test:e2e` 全部通过；两条 AC 的实际达程度已逐条注明）

- [x] 该决策下没有任何已结算 Prediction 时，清单可写
- [x] 出现已结算 Prediction 后，写清单被拒绝，且拒绝信息**指名是哪一条**预测的结算导致的，并且一行都不写
- [ ] 锁定时点被记录，且**锁单向**：判据 = 事实（该决策下有已结算的 Prediction）∨ 已记录的 `lockedAt`。只看事实会漏掉一条**已经存在**的路径——`undoQuestionResolution` 把 `resolved` 置回 `false`，门会重新打开
- [x] **锁定不可被绕过**（复盘时补上）：
  - 已结算的 Prediction **不允许解绑**——解绑会让“该决策下任一 Prediction 已结算”这个
    唯一判据失效，门重新打开（`decision_router.detachPrediction` → `CONFLICT`）。
  - 挂上一条**已结算**的 Prediction 时立即记录锁定时点，避免出现“锁已生效但时点为空”的状态。
- [x] 锁定只作用于清单 —— **已被 ADR-0037 取代**：揭晓后叙事与清单一起冻结，事后表达走独立、只增不改的 `record-reflection`（原先"叙事字段仍可补充"的口径不再成立；改写已填写内容须带理由并留痕仍由 ADR-0012 管，但只在揭晓前）
- [x] 界面上锁定态会说明原因（详情页的清单区展示锁定提示）——**如实说明：页面目前根本没有清单写入入口，所以“只读”是被陈述的而不是被界面阻止的**；真正的拒绝在服务端（`CONFLICT`），并已由 e2e 用 `set-rubric` 实跑断言（非零退出 + stderr 写明“已锁定”）
- [x] 决策页同时呈现"清单完成度"与"各 Prediction 的结算结果"——**如实说明：目前是同一页内的上下两区，真正的两栏并排留给 ticket 06 的复盘视图**

> 判据取**事实 ∨ 已记录的时点**：事实侧由 `findLockingPrediction` 给出，时点侧由 `lockedAt` 给出。两者各补对方的洞——只看事实，撤销结算即可开门；只看时点，结算路径与写入之间崩溃就会出现“事实已成立而时点为空”。
