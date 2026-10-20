# 01 — 决策动作与执行事实：模型与迁移

**What to build:** 一条决策能记下"我要做什么、承诺何时完成"，并能记下"做没做/何时做"的多次事实；两者都不进校准，且状态由纯函数推导。

**Blocked by:** None — can start immediately

**Status:** implemented（验证：`npm test -- decision_action` 覆盖状态推导与冲突判定；
`npm test -- revisions decision_router` 覆盖留痕与守卫分支——只跑前一条会漏掉"改写必须留痕"；
`npx prisma migrate deploy`）

- [x] `Decision.action` / `Decision.actionDueAt`（可空）：动作与承诺时点属于"当初的记录"
- [x] `DecisionExecution { kind: EXECUTED | ABANDONED, occurredAt, note? }`：只增不改的事实流
- [x] 迁移只有新增（两条可空列 + 一张表 + 一个枚举），因此不需要 `verify-migration-upgrade` 补检查
- [x] 纯函数 `actionStateOf`：未记录 / 计划中 / 逾期 / 已执行 / 已放弃，且"事实优先于声明"
- [x] 纯函数 `executionConflict`：必须先有动作；执行与放弃互斥
- [x] `planActionRevisions`：改写已填动作/时点必须留痕；空白→填写是补写

**实现说明**

- 状态**不落库**（同 ADR-0020 第三点）：落库的状态必然过期。
- `ABANDONED` 是独立取值而不是"一直没执行"，否则「放弃」会被永久读成「逾期未做」。
- 执行事件**不冻结**：多阶段执行可能晚于揭晓（ADR-0041 §三），它靠"只增"防改写。
