# 共享题：可见性沿用现有三源，并有锚定保护

能看到一条 Prediction 的口径**沿用代码里已有的三源**——「我创建的 / 我预测过的 / 被分享给我的」（`getQuestionsUserCreatedOrForecastedOnOrIsSharedWith` + `Question.sharedWith` / `sharedWithLists`），不发明新语义。

在此之上加一条 **Anchoring Protection（锚定保护）**：同一条 Prediction 下，**其他 Owner 的 Forecast 值在你提交自己的之前不可见**；提交后即可见，复盘期当然可见（相对分与校准本就需要）。

这不是新增能力，而是把 CONTEXT.md 里已有的 **Nominal Group Technique**（"先让成员独立、异步地提交意见与预测，再集中讨论分歧"）变成强制形式——先看见别人的数字再下注，就是在重复他的锚，而不是表达你自己的信念。本工程存在的理由就是让信念**被显性化**，所以这条保护必须由系统执行，而不能只写在方法论文档里。

**决策是容器**（[ADR-0019](./0019-decision-as-container-of-predictions.md)）：分享一条 Decision 等于分享它挂着的 Prediction，但每条 Prediction/Forecast 仍归各自的 Owner，**分享不改变归属**。

## Considered Options

- **沿用上游的"共享即可见全部"**：实现为零，但共享一开放，锚定就立刻发生；对一个以"提高决策质量"为目的的工程，这等于把主要风险直接引入。
- **可见但标注"这是他人锚点"**：等于承认锚定会发生，只是给它贴标签。
- **连"这条题存在"也隐藏**：过度——合作场景需要先知道有人在同题上押注（否则两个人会各建一条重复的题）。

## Consequences

- 需要一条"提交前不可见"的读取规则，但它与相对分不冲突：相对分在结算后计算，那时所有人都已提交。
- 决策树 **D 分支**（共享题上谁有权结算）因此变得更尖锐：现状按 `Question` 的 Owner 授权（`agent_router.ts:371` 的 `assertOwnedQuestion`），意味着**建题者可以结算他人的信念**——与 ADR-0008 的保护意图冲突。已由 [ADR-0029](./0029-settlement-authority-by-forecast-owner.md) 裁决：改按判据类型加 Forecast 的 Owner 授权。
- 可见性规则在 CLI 与 Web 两面都必须成立（[ADR-0023](./0023-interaction-surface-parity.md) 的对等要求），不能只在界面上做。
