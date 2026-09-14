# 共享题上按 Forecast 的 Owner 授权结算

[ADR-0004](./0004-layered-settlement-authority.md) 的分层授权只按**判据类型**分层，没有区分"是哪个人"。在多 Owner 场景下这留下一个洞：`agent.settle` 按 `Question` 的 Owner 断言（现状 `assertOwnedQuestion`），于是 **A 建题、B 押注时，A 能结算 B 的信念**——ADR-0008 的保护被绕过了。

决定：把 ADR-0004 的"用户"精确化为**该 Prediction 的 Owner**。

- **公共事实**：任何身份都可自行结算，**但必须附可核查来源**；无来源降级为提案。客观来源不因身份而变，所以这一档不含身份限制。
- **Agent 可观测**：只能由**该 Prediction 的 Owner** 确认提案。
- **自我报告**：**只能**由该 Prediction 的 Owner 本人报告，并对照决策时冻结的评分锚点。
- **建题者的身份不带来任何结算特权**。

## Considered Options

- **维持按 Question 的 Owner 授权**：实现零成本，但建题者可以判定他人的信念——正是 ADR-0008 要防的那件事。
- **双签（建题者与预测者都确认）**：最严，且单 Owner 部署下是纯粹多出来的摩擦。

## Consequences

- `agent.settle` 的断言从"按 Question 的 Owner"改为"按判据类型加 Forecast 的 Owner"。
- **结算是 Question 级的单一状态，而确认权现在分属于各个预测者** ⇒ 会出现"题已可结算，但某个 Owner 尚未确认"的中间态。这个中间态**必须能被表达**，否则一个不确认的人就能卡住整条题。表达方式（每条 Forecast 各自确认到账？还是题级状态加待确认清单？）**尚未决定**，留给实现时裁决。
- ADR-0004 / ADR-0008 里写的"用户""当事人"，按 CONTEXT.md 的 **Owner** 词条解释——即相关记录的 Owner，不是建题者、也不是提问的人。
