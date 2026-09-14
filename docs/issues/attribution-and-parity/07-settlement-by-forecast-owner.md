# 07 — 结算授权按 Forecast 的 Owner

**What to build:** 建题者不能替他人结算；Agent 可观测需该预测 Owner 确认；自我报告只能本人；公共事实带来源时任何身份可结算。

**Blocked by:** None — can start immediately

**Status:** ready-for-agent（ADR-0029）

- [ ] `agent.settle` 由"按 Question 的 Owner 断言"改为"按判据类型 + Forecast 的 Owner"
- [ ] A 建题、B 押注时 A 结算被拒，错误信息说明原因
- [ ] **开放项**：可结算但某人未确认的中间态怎么表达（ADR-0029 未决）
