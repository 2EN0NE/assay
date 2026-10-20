# 决策动作是当初的记录，执行事实是只增不改的事件流

[ADR-0019](./0019-decision-as-container-of-predictions.md) 让 Decision 成为 Prediction 的容器。[ADR-0037](./0037-narrative-freeze-and-reflection-channel.md) 把"当初的记录"（叙事）与"事后表达"（`reflection`）分开。[ADR-0039](./0039-status-brief-computed-not-stored.md) 让系统能报出"世界该给答案了"。[ADR-0038](./0038-unrecorded-is-not-not-done.md) 修掉了"没记 ≠ 没做"。

四件事合起来仍然缺一格：**决策对世界做的那件事，本身没有落点。**

后果不是少一个字段，是三类事实被压成两类：

- **过程质量**（清单）、**结果质量**（Brier）现在能分开；
- 但「**没做**」与「**做了但没用**」分不开。两者的补救方向相反——前者改执行，后者改判断。

现场证据：那条真实决策的 `statement` 写着「昨日买入、今日涨停后止盈」——动作与时点都在，但它们是**散文里的字**：不可查询、不可冻结、不可提醒。事实存在，落点不存在。

## 一、三个词，三个主语

| 术语                     | 主语 | 何时写           | 计分               |
| ------------------------ | ---- | ---------------- | ------------------ |
| **Prediction**           | 世界 | 决策当时         | 是（Brier / 校准） |
| **Action / 决策动作**    | 我   | 决策当时（承诺） | 否                 |
| **Execution / 执行记录** | 我   | 事后（事实）     | 否                 |

分辨方法一句话：**预测的主语是世界，动作的主语是我。**「000592 会跌回 8.31」是预测；「今天以 8.37 卖出」是动作。

**为什么执行不能写成 Prediction**（这是本 ADR 最容易走错的一步）：把「我会在 Q4 前把预算压到 40 万」写成一条 `SELF_REPORT` 预测看起来能复用整套结算机制，但「我会不会做」由我自己说了算，「世界会怎样」不是。两个难度不同的量混进同一条 Brier 曲线，会同时毁掉两边：校准不再衡量判断力，而执行率也得不到独立读数。

## 二、承诺半边：`action` / `actionDueAt`，与叙事同一条机制

- `Decision.action`（`String?`）：做什么，可核对——动词 + 对象 + 量。
- `Decision.actionDueAt`（`DateTime?`）：承诺何时完成。

**留痕与冻结沿用 ADR-0012 × ADR-0037**：改写已填内容须带理由并生成 `Revision`；揭晓后连同空白一并冻结（同一个 `decisionLockOf`）。

为什么不新造第二套：本仓库已经在"两套日志实现"和"两套清单问法"上各吃过一次亏。动作与叙事面对的自利方向相同（事后把承诺改成与结果相符的版本），因此用同一套机制。

**残余风险（承认而不是掩盖）**：揭晓前把**空白**动作补写是自由的（与叙事一致），所以理论上可以在做完之后补一个"看起来像当初就打算这么做"的动作。可用的边界只有揭晓，而用它已经比"永不记录"好得多——ADR-0012 选「补空白不算改写」时也是同一个取舍。

## 三、事实半边：`DecisionExecution`，只增不改

```
DecisionExecution { id, decisionId, kind: EXECUTED | ABANDONED,
                    occurredAt, note?, createdAt }
```

- **只增不改**：没有 update / delete 命令。更正靠再写一条（"更正：实际 4800 股"），与 `DecisionReflection` 同一形态。
- **不冻结**：多阶段决策里揭晓可能早于最后一次执行（"分三期建仓"，首期后就有预测结算）。冻结它会让执行记录永远无法完成。它靠**只增**防改写，而不是靠冻结——两种防线的对象不同：冻结防的是"改写承诺"，只增防的是"改写事实"。
- **`ABANDONED` 是独立取值，不是"一直没执行"。** 否则"明确放弃"会被永久读成"逾期未做"，而 CONTEXT 明确写着「放弃同样是美德」（Kill Criteria）。放弃与执行**互斥**：已放弃后再报执行、或已执行后再报放弃，服务端拒绝。
- **必须先有动作**：动作从未写下时拒绝记录执行——那会让"执行了什么"无法解释。

派生状态（不落库，与 ADR-0020 第三点同一条理由）：`未记录 → 计划中 / 已逾期未执行 / 已执行 / 已放弃`。

## 四、读数：Brief 多一栏，`list-decisions` 多一个下钻

- `brief.actions = { planned, overdue, executed, abandoned }`；`overdue` 是"承诺到期而既没执行也没放弃"的条数；
  `planned` 是"还没到承诺时点、**或压根没写承诺时点**"的条数——两者合并在一个计数里是刻意的：
  "我说了要做但没说什么时候"与"我说了 11-02 之前做"在简报层面要求的动作相同（补时点或开始做），
  拆成两个数会让简报多一栏而不多一条信息。想分辨时看 `show-decision` 的 `actionState`。
- **下钻过滤可以叠加，叠加即交集。** `list-decisions --rubric-missing --action-overdue` 返回"清单从未记录
  **且** 动作已逾期"的决策，而不是让后一个 flag 静默失效——静默丢弃与 ADR-0039 第六点"必须给出可执行的
  下钻"相违：给了命令却让它悄悄不生效，比不给更坏。
- 下钻：`list-decisions --action-overdue`。

**不把动作塞进 `nearest`（那个 3 条明细）**：它的定义是"预测按 `resolveBy` 由近到远"，混进另一种单位会让"由近到远"失去意义。动作是**计数 + 下钻**，不是明细位。

## 五、明确不做

- **不进校准**：见第一点。
- **不新增清单条目**（"动作是否具体可执行"）：要新建决策版本（ADR-0020 第四点），收益不如"冻结 + `brief` 提醒"这一对；将来若做，随 v2 一起。
- **不做多动作实体**：一个决策一次动作；多步（分三期建仓）用**多条执行事件**表达，而不是多条动作。把"一个决策有三个动作"做进模型，会让"决策是否被执行"重新变得不可判定。

## 补充 / 修正了谁

- **本 ADR 补充 [ADR-0019](./0019-decision-as-container-of-predictions.md)**：Decision 除了是 Prediction 的容器，还承载**一个动作**。「一条 Prediction 至多属一个 Decision」的容器关系不变；新增的是容器里的"我做了什么"，它**不进**预测的结算与校准。
- **本 ADR 扩展 [ADR-0037](./0037-narrative-freeze-and-reflection-channel.md) 的冻结对象**：揭晓后冻结的不只是五个叙事字段，还包括 `action` / `actionDueAt`（承诺半边）。**`DecisionExecution` 明确不在冻结范围内**——理由是第三点（多阶段执行），而不是疏漏。
- **本 ADR 扩展 [ADR-0039](./0039-status-brief-computed-not-stored.md) 的简报栏位**：新增 `actions` 计数；`nearest` 的语义（只取预测、按 `resolveBy`、≤3 条）**不变**，动作不进明细位。
- **本 ADR 修正 `docs/roadmap.md` Phase 3 的「Kill Criteria：预承诺『状态 + 日期』，到期检测并提醒执行」**：该条此前没有任何字段与命令承载（许愿式文档）。本 ADR 实现其可观测的那一半（承诺到期 → `brief.actions.overdue`）；"预承诺的**终止条件**"（状态 + 日期触发即执行）仍是独立能力，**未实现**，不在本 ADR 范围内。

## Considered Options

- **把执行写成一条 `SELF_REPORT` Prediction**：复用结算与制表机制 → 把执行混进校准，两个难度不同的量互相污染（见第一点）。
- **只在 statement 里写清楚动词**（不加字段）：零成本 → 仍然不可查询、不可冻结、不可提醒；与 ADR-0038 修掉的那个病同形。
- **单字段 `executedAt` / `abandonedAt`（不建表）**：少一张表 → 多阶段执行只能记第一次，其余事实只能落进 `reflection`，又把"事实"与"评价"混在一处（这正是本 ADR 要拆开的东西）。
- **执行可改（update/delete）**：好纠错 → 与 `reflection` 的理由相同：改写事实是无声的，而无声比"要靠再写一条更正"更危险。
- **动作必填**：逼出可执行性 → 纯判断型决策（"我认为这只股会涨，不操作"）没有动作；必填会造出"为了填而编一个动作"，那是新的敷衍数字。改为**可选 + 提示**。

## Consequences

- **schema**：`Decision.action` / `Decision.actionDueAt`（可空，无回填 ⇒ 不需要 `verify-migration-upgrade` 补检查，按 AGENTS.md 的规则）；新表 `DecisionExecution`（`@@index([decisionId])`）+ 枚举 `ExecutionKind`。
- **纯函数**：`actionStateOf(...)`（未记录 / 计划中 / 逾期 / 已执行 / 已放弃）+ `planActionRevisions(...)`（复用 `serialize` / `isSame`）。
- **写入面**：`create-decision --action --action-due`、`update-narrative --action --action-due`（同一套留痕与冻结）、`record-execution`。两个表面都要有（`cli/parity.test.ts` 会拦 `decision.recordExecution`）。
- **读数面**：`brief.actions`、`list-decisions --action-overdue`、`show-decision` 返回 `executions` 与派生状态。
- **skill / AGENTS.md**：捕获时"写下动作与承诺时点"；复盘时"先问做了没有（执行/放弃），再谈判断"。
