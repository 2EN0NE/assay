# Decision 是一等实体，Question 只是它的可验证子部分

一个 **Decision（决策）** 是一等顶层实体，承载决策时点的推理过程（陈述、理由、预期后果、当时已知/未知信息、决策质量评分），并包含 0..n 个 **Prediction**（可验证命题，落为现有 `Question` + `Forecast`）。

我们选择新建独立实体，而不是把决策编码为 `Question` 的标签或备注，也不是把决策等同于单个 `Question`：**核心原则 1（区分决策质量与结果质量）要求把"当时为什么这么判断"持久化**，才能让 Resulting 偏差可被拦截——tag/notes 无法结构化承载，也无法对决策独立评分。Prediction 层则复用 Fatebook 已有的记录 / 结算 / 计分能力，避免重建。

## Considered Options

- **轻量容器**：Decision 仅作分组标签、无自身字段 → 存不下决策时点的推理，原则 1 落空。
- **不引入 Decision**：用 tag / notes 表达 → 脆弱、不可结构化、不可评分。
- **决策即 Question**：把决策等同于一个可验证问题 → 与"一个决策可拆出多个预估"的语义冲突。

## Consequences

- 新增 `Decision` 实体与 `Decision → Prediction` 关联；`Prediction` 复用现有 `Question`/`Forecast`。
- 需要一条 Agent 引导流程，把自然语言决策转成 `Decision` + 若干 `Prediction`。
- **阶段归属**：`Decision` 实体本身属 **Phase 2**——见 [`docs/roadmap.md`](../roadmap.md) Backlog 的「区分决策质量 / 结果质量」与「决策量表（Decision Rubric）」，两条都标 Phase 2「未开始」。Phase 1（MVP）只兑现本 ADR 的另一半：`Prediction` 复用 `Question`/`Forecast`，并挂上判据类型 / 录入来源 / 背书三个语义字段（见 ADR-0002 / 0007 / 0008）。**不要因本 ADR 而提前建 `Decision` 表**——Phase 2 的复盘视图与清单字段尚未定义，提前建只会得到一张空表。
- **未决（随 Phase 2 的 `Decision` 表一并解决）**：无法被外部事实判定真伪的"预估"（如"这个决定会让我更满足"）如何归属 Decision。判据侧不受影响——ADR-0002 已把 `SELF_REPORT` 定为一等判据类型，且 ADR-0011 允许它带 0 个 `Forecast`；待定的只是它在 `Decision` 关系上的归属。
