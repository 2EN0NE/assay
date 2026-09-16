# 05 — 审计元数据落库

**What to build:** 每条记录留下调用上下文（发起方类别 + pi 会话标识 + 时间），可查、可对质；不含会话正文。

**Blocked by:** 04

**Status:** implemented

- [x] Prisma 迁移只加列
- [x] 能筛出"来自会话却声明数字由当事人给出"的记录
- [x] 审计字段不进入面向他人的读路径（与 06 的可见性一致）

### 实现说明（供后续票据复用）

- schema：`Question` 与 `Forecast` 各加 `initiator InitiatorKind @default(HUMAN)` + `agentSessionId String?`；新枚举 `InitiatorKind { HUMAN, AGENT }`。迁移 `20260914120000_audit_metadata` **只加列，无回填**（存量行按默认值 HUMAN 解释）。
- 发起方类别与来源声明**分开存**：`initiator = AGENT` + `provenance = HUMAN` 不是缺陷（当事人在 agent 会话里亲口给数字就该长这样），但它必须能被筛出来对质。
- 取线索用 `cli/args.ts` 的 `auditContext()`（与 `invokedByAgent()` 同源），`PI_SESSION_ID` 只存标识，**不存会话正文**（ADR-0027）。
- `agent.createPrediction` 的 `initiator` 必填（与 `statedByOwner` 同一理由：路由层不给默认值）。`agent.listAuditRecords` 提供筛选，`--only-owner-claims` 就是那条"来自会话却自称人给的"视图。
- **登记了一条 parity 例外**（`agent.listAuditRecords`）：全库级审计复查不是单条问题的视图，而审计字段在他人读路径上的可见性 ADR-0027 明写"尚未裁决"。不是静默缺失。
- 真库验收：`AI_AGENT=pi PI_SESSION_ID=… create-prediction` 后，`list-audit-records --only-owner-claims` 能列出它（含 `ownerClaimFromSession: true`）。
