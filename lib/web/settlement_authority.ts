/**
 * 结算授权矩阵（ADR-0004 分层 + ADR-0029 按 Prediction 的 Owner 精确化）。
 *
 * 为什么它必须是一个纯函数：授权错的方向只有一个——**建题者（或任何与这条预测
 * 无关的身份）能判定他人的信念**。那不会报错，只会安静地绕开 ADR-0008 的保护，
 * 而事后复盘时看不出任何异常。所以这张矩阵要能被逐格断言。
 *
 * 关键：**建题者的身份不带来任何结算特权。**
 */
export type SettlementOracleKind =
  | "PUBLIC_FACT"
  | "AGENT_OBSERVABLE"
  | "SELF_REPORT"

export type SettlementDecision =
  | { mode: "settle" }
  | { mode: "propose"; downgraded: boolean }
  | { mode: "requires-human-report" }

export function decideSettlement(args: {
  oracleKind: SettlementOracleKind
  /** 调用方是否带着可核查来源。 */
  hasSource: boolean
  /** 调用方是否**就是**这条预测的 Owner（在该题上押过注）。 */
  callerOwnsForecast: boolean
}): SettlementDecision {
  switch (args.oracleKind) {
    // 客观来源不因身份而变，所以这一档不含身份限制；但没来源就只能降级为提案。
    case "PUBLIC_FACT":
      return args.hasSource
        ? { mode: "settle" }
        : { mode: "propose", downgraded: true }

    // Agent 能观测到、但判定权在 Owner 手里：一律走提案，由 Owner 确认。
    case "AGENT_OBSERVABLE":
      return { mode: "propose", downgraded: false }

    // 自我报告：只有该 Prediction 的 Owner 本人能报告。
    case "SELF_REPORT":
      return args.callerOwnsForecast
        ? { mode: "settle" }
        : { mode: "requires-human-report" }
  }
}
