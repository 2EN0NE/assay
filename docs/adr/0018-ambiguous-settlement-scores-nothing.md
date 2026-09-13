# 结算判为 AMBIGUOUS 时不计分：它是"没有样本"，而不是"满分"

`Resolution` 取 `AMBIGUOUS` 时，该 `Prediction` **不产生任何 `QuestionScore`**。它的 `Forecast` 既不算对也不算错——判据判不出来意味着没有信息，而不是零损失。

## 为什么值得单独记一条

写这段代码时最容易顺手写出的是"给每个预测者一条零分占位"。它有两个坏处，第二个尤其隐蔽：

1. 零分若落了库，`relativeScore = 0` 是 Brier 的**满分**语义——判不出来的题会把所有人排到第一名。
2. 更隐蔽的是它会掩盖真正的口径问题：系统对 AMBIGUOUS 的立场已经由 `pages/api/calibration_graph.ts` 的 `Exclude ambiguous questions` 表达过；计分层若再造一个占位，同一个排除就有了**两处定义**，而"校准排除只有一个定义处"是本仓库的硬约束（AGENTS.md）。两处口径迟早漂移，且漂移时没有任何症状。

## Considered Options

- **给每个预测者一条零分占位**：保留了"谁参与了"这一形状，但该形状没有生产消费者（`scoreQuestion` / `scoreQuestionOptions` 的全部调用点都是 `await X(...)` 不接收返回值，"每人一条零分"唯一的消费者是测试自己），而哨兵值 `0` 的语义是错的。
- **不落库、但仍返回占位**：等价于上一条减去落库，仍然是上了一半膛的枪。
- **返回空集合**（选中）：判不出来的题就是没有样本。

## Consequences

- `scoreQuestion` / `scoreQuestionOptions` 在 `AMBIGUOUS` 下返回空 `ScoreCollection`，且不调用 `scoreForecasts` / `scoreOptionForecasts`。
- 「不参与相对分」全仓**只有一个表示：`null`**（ADR-0002 已定）。因此 `ScoreTuple.relativeBrierScore` 的类型是 `number | null | undefined`，而 `dropRelativeScores` 写 **`null`**、不写 `undefined`——后者会被 Prisma 当作"跳过该字段"，于是 `create` 看着对（列默认 NULL）、`update` 却把旧值留在库里。读侧的 `null` 过滤（`pages/global-stats.tsx`）与 `AVG` 忽略 null 因此不必改。
- AMBIGUOUS 的问题在 `pages/global-stats.tsx` 里仍有计数（"Questions resolved as AMBIGUOUS"）——**可见性不受影响**，消失的只是校准样本。
