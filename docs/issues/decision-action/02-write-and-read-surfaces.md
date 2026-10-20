# 02 — 写入面与读数面：动作、执行、简报

**What to build:** 捕获决策时能同时写下动作与承诺时点；做完/放弃能记一条事实；状态在复盘页、`show-decision`、简报与下钻里都看得见，且 CLI 与 Web 两个表面都有入口。

**Blocked by:** 01

**Status:** implemented（验证：`npm test -- decision_router agent_router`；`npm run --silent agent -- brief | jq .`；`npx next build`）

- [x] `create-decision --action --action-due`：承诺时点不能脱离动作存在
- [x] `update-narrative --action --action-due`：与叙事同一条留痕/冻结规则
- [x] `record-execution --decision-id [--abandoned] [--at] [--note]`：只增不改、不设时机门槛
- [x] `decision.byId` 返回 `executions` 与 `actionState`；Web 决策页显示动作、状态与两条写入按钮
- [x] `brief.actions = { planned, overdue, executed, abandoned }`；`seeAlso.actionOverdue` 指向真实命令
- [x] `list-decisions --action-overdue`：与简报同一处派生，不出现两套数字
- [x] `cli/parity.test.ts` 仍绿：`decision.recordExecution` 两侧可达，未新增例外

**实现说明**

- 动作**不占简报的 3 条明细位**：明细的语义是"预测按 `resolveBy` 由近到远"，混进另一种单位会让"由近到远"失去意义（ADR-0041 §四）。
