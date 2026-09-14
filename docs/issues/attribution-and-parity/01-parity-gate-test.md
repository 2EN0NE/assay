# 01 — 对等性守门测试

**What to build:** `npm test` 能在"某条 procedure 只在单侧可达、且未登记为有意例外"时失败；例外表每条带理由。

**Blocked by:** None — can start immediately

**Status:** implemented（验证：`npm run test:coverage` 全绿，`cli/parity.test.ts` 6 例；例外表 12 条各带理由）

- [x] 测试遍历 agent/decision router 的全部 procedure
- [x] 未登记的单侧 procedure 让它变红（故意加一条验证）
- [x] 现状例外全部登记：登录、5 条决策写命令、4 条待议、`decision.list`

## 实现说明（与票据措辞的两处偏差）

- **可行性从源码读，不手抄**：CLI 面扫 `cli/commands.ts`，Web 面扫 `pages/` + `components/` 里的
  `api.<router>.<name>`。因此"某条 procedure 只在单侧可达"是**测出来的**，不是声明出来的——
  声明式的清单会在实现漂移后继续"全绿"。
- **「登录」不是本守门的对象**：sign-in 走 NextAuth，不是 `agent` / `decision` 两个 router 上的
  procedure。ADR-0023 把它登记为**永久例外**，形态不同（邮件 / 凭据）能力相同，因此它不在
  `cli/parity.test.ts` 的例外表里（那张表只对有 procedure 形态的能力负责）。
- **`decision.list` 不需要登记**：Web (`pages/decisions/index.tsx`) 与 CLI (`list-decisions`)
  都已可达，因此它**不是**单侧能力——见 08。
- 例外表**过期即变红**：另一侧补上后，那一行必须删掉，否则测试报出"该行可以删了"。
