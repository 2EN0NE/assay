# 14 — CLI：`detach-prediction`

**What to build:** CLI 侧有一条与 `attach-prediction` 对称的解绑命令；已结算的 Prediction 仍拒绝解绑（那是锁定唯一的可逆口）。

**Blocked by:** 10

**Status:** implemented（验证：`npm run typecheck` / `npm run lint` / `npm test` 全绿）

- [x] `detach-prediction --question-id ID` 解绑：把 `decisionId` 置空，而不是删掉预测
- [x] 被解绑的预测**已结算** ⇒ 拒绝（会把已经关上的门重新打开）
- [x] 未结算的预测即使所在决策已锁定，也可解绑（锁由已记录的时点保持，不靠"还挂着哪条预测"）
- [x] stdout 仍是确定性 JSON，错误走 stderr 且非零退出
