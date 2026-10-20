# 10 — 锁定单向、不可回退

**What to build:** 锁定判据从"只看事实"改成"事实 ∨ 已记录的锁定时点"，并在结算路径写下这个时点。于是撤销结算（`resolved` 被置回 `false`）不会重新打开清单，已结算的 Prediction 也仍然不许解绑。

**Blocked by:** 09

**Status:** implemented（验证：`npm run typecheck` / `npm run lint` / `npm test` 全绿；结算路径的写入用真库探针确认过 `updateMany` 的关系条件可用）

- [x] 锁定判据 = 该决策下有已结算的 Prediction（事实）**或** 已记录的 `lockedAt`；两者各补对方的洞（只看事实→撤销结算即开门；只看时点→时点还没写上）
- [x] 结算路径（该 Question 已属某 Decision 时）写入 `lockedAt`；`undoQuestionResolution` / `undoQuestionOptionResolution` **不**清除它
- [x] 测试：结算 → 撤销结算 → 再写清单**仍被拒**（只看事实的实现会在这条上失败）
- [x] 挂载一条已结算的 Prediction 时仍立刻记下时点，拒绝信息指名是哪条预测
- [x] 被拒时的信息说明"曾因某次结算锁定，且该结算已被撤销"——即锁定时点单独成立时，不能只回一句"已锁定"
