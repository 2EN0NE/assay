# 数据落在现有 Prisma schema 内：新增两张表，Prediction 复用 Question

决策记录直接**扩展现有 Prisma schema**（Postgres），既不另起一套表，也不放进仓库文件（`D` = ①）。具体形态：新增 `Decision` 与 `Revision` 两张表；`Prediction` **在实现上就是现有的 `Question`**，因此可直接复用已经跑通的结算、计分、校准图、列表与权限。

为什么不是文件（③）：ADR-0007 把人工 UI 定为最高权威的输入源，而文件系统撑不起那个 UI——要重建查询、并发、权限与校准聚合，等于把项目里已经存在的一整套东西扔掉再写一遍。

为什么不是独立表（②）：会制造**两套真相**。`Question`/`Forecast` 已经背着结算、计分（Brier / Relative Brier）、校准图与权限这一整条链路；新的 Prediction 表要么与它同步（复杂度翻倍），要么绕开它（那么校准图立刻失去意义）。

为什么是 ①：这是唯一让"**新概念复用旧管道**"的选项。Phase 0 清单里那四项（结算字段、枚举、通知循环、定时任务）**不需要重写**，只需把新的语义字段挂上去。

## Considered Options

- **② 新建独立表**：两套预测并存，立即面临同步问题。
- **③ 仓库内 Markdown / 文件**：与 ADR-0007 直接冲突。

## Consequences

- `Question` 需新增字段以承载新语义：判据类型（`Resolution Oracle` 种类）、录入来源（`Provenance`）、背书状态（`Endorsement`）。
- ADR-0011 要求 `Prediction` 可有 **0 个** `Forecast`；需确认现有关系允许这一点（`forecasts` 为列表关系时天然成立）。
- 两张新表**分属两个阶段**：`Revision`（ADR-0012 的留痕）属 **Phase 1（已交付）**；`Decision`（一次资源分配）属 **Phase 2**（见 [`docs/roadmap.md`](../roadmap.md) Backlog）。本 ADR 的决策是"数据落现有 Postgres schema、`Prediction` 复用 `Question`"，**不是**"现在就建 `Decision` 表"；提前建表等于把 Phase 2 提前而没有其验收内容（见 ADR-0001 的阶段归属）。
- 现有 LLM 入口（`parseDecision`）与新字段的关系**已定**（roadmap `G`）：MVP **不接线**，自然语言解析由 pi 侧承担；若将来接线，必须补认证 + 限流（现状是未认证的 `publicProcedure`）。
