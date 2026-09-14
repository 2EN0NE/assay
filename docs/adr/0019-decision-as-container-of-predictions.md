# Decision 是 Prediction 的容器：1 → 0..n，删容器不删预测

一个 **Decision** 包含 **0..n 个 Prediction**；一条 Prediction **至多**归属一个 Decision。这个关联落在 `Question` 上的**可空外键**（Prediction 复用 `Question`/`Forecast`，见 [ADR-0001](./0001-decision-as-first-class-entity.md)），因此对既有数据与既有功能是**纯加成**：不挂 Decision 的 Question 照旧工作。删除 Decision 时外键**置空**，不级联删除 Prediction。

这关闭了 ADR-0001 遗留的未决项——"无法被外部事实判定真伪的预估（如'这个决定会让我更满足'）如何在 Decision 关系上的归属"。答案是**不另开通道**：它落为 `oracleKind = SELF_REPORT` 的普通 `Question`（[ADR-0002](./0002-prediction-oracle-and-layered-scoring.md) 已把 `SELF_REPORT` 定为一等判据类型，[ADR-0011](./0011-unquantified-predictions.md) 已允许它带 0 个 `Forecast`），因而同样通过这个外键归属。既然自评类已经是一等 Prediction，就没有理由为它单独造一种关系。

删除之所以选 `SetNull` 而非级联：Prediction 一旦冻结就已带上判据、期限与锚点，可能已结算并已**计入校准**。它比容器活得久，删容器不该让已产生的校准样本消失。

## Considered Options

- **决策即 Question（1 → 1）**：把一个决策等同于一条可验证命题 → 与"一个决策拆出多个预估"的语义冲突，ADR-0001 已排除。
- **多对多**：允许一条 Prediction 同属多个决策 → 复盘视图会重复计算同一条预测，且"这条预测是为哪个决策下的注"变得不可判定。
- **级联删除**：删决策连带删 Question → 丢失已冻结、可能已计入校准的记录。
- **给自评类另设关系**：为"不可外部判定真伪的预估"新造一张表或一种关联 → 与 ADR-0002 把它定为一等判据类型的决定重复。

## Consequences

- Prediction 侧**不需要任何新实体**：只加一个可空外键，既有的结算 / 校准 / 判据类型 / 录入来源 / 背书 / 修订留痕能力全部自动继承。
- 一个 Decision 的 Prediction 数量可以是 **0**——"我还没想清楚要验证什么"是合法状态，与 ADR-0011 对未量化的态度一致。
- 复盘视图的"结果侧"因此是**确定且不重复**的一组 Prediction。
- ADR-0001 中标注为"随 Phase 2 的 `Decision` 表一并解决"的未决项**由此关闭**。
