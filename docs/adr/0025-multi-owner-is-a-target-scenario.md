# 多 Owner 是目标场景：同一条 Prediction 上允许不同 Owner 各自押注

多 Owner 不是"假设不会发生"的边界情况，而是**预期场景**：库里会有多个 Owner，且同一条 Prediction 下会存在分属不同 Owner 的 Forecast。相对分因此**保留**——它的定义本来就是"相对同期**其他预测者**中位数"（[ADR-0002](./0002-prediction-oracle-and-layered-scoring.md)），没有第二个预测者它就没有分母。

这与此前"只留接缝、不实现多用户"的裁决**不冲突**，两者管的不是同一件事：

- 仍然**不建**多租户的界面、邀请与管理（那部分继续推迟）；
- 但**数据与语义按多 Owner 成立**：`Question.sharedWith` / `sharedWithLists` 属于本工程自己定义的功能面，**不再当作范围外**。

理由：数据模型（`Forecast.userId`、`QuestionScore.userId`）与相对分实现**早就按多人写好并有单测覆盖**——本决策不是"新增能力"，而是承认已经存在的能力有真实用途。单人部署下相对分为 `null` 是**正常状态**，不是缺陷。

## Consequences

- "共享题"从此是一条正常路径而非例外：同一 Prediction 下多个 Owner 各自的 Forecast、各自的 QuestionScore 都要能正确表达与显示。
- 相对分的口径必须写死：**同期、同题的其他预测者**（否则跨题跨期不可比，这正是 ADR-0002 要解决的问题）。
- 界面与 CLI 都要能回答"这条预测/这条分数是谁的"——受 [ADR-0023](./0023-interaction-surface-parity.md) 的对等要求约束。
- 共享题上的**结算权限**与**可见性**语义仍未裁决（决策树的 B 与 D 分支）。
- 单人部署里相对分恒为 `null`，复盘时那一栏是空的——已知后果，不是 bug。
