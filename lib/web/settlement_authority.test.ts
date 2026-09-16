import { decideSettlement } from "./settlement_authority"

/**
 * ADR-0029 授权矩阵的逐格断言。
 *
 * 存在理由：授权错的方向不会报错——它只是让建题者（或任何无关身份）安静地判定
 * 他人的信念，绕开 ADR-0008 的保护，而复盘时看不出异常。
 */
describe("decideSettlement —— 结算授权矩阵（ADR-0029）", () => {
  it("公共事实 + 有来源 ⇒ 直接结算（这一档不含身份限制）", () => {
    expect(
      decideSettlement({
        oracleKind: "PUBLIC_FACT",
        hasSource: true,
        callerOwnsForecast: false,
      }),
    ).toEqual({ mode: "settle" })
  })

  it("公共事实 + 无来源 ⇒ 降级为提案", () => {
    expect(
      decideSettlement({
        oracleKind: "PUBLIC_FACT",
        hasSource: false,
        callerOwnsForecast: true,
      }),
    ).toEqual({ mode: "propose", downgraded: true })
  })

  it("Agent 可观测 ⇒ 一律提案，由 Owner 确认（有没有来源都一样）", () => {
    for (const hasSource of [true, false]) {
      expect(
        decideSettlement({
          oracleKind: "AGENT_OBSERVABLE",
          hasSource,
          callerOwnsForecast: true,
        }),
      ).toEqual({ mode: "propose", downgraded: false })
    }
  })

  it("自我报告 + 我就是该 Prediction 的 Owner ⇒ 本人报告，可结算", () => {
    expect(
      decideSettlement({
        oracleKind: "SELF_REPORT",
        hasSource: false,
        callerOwnsForecast: true,
      }),
    ).toEqual({ mode: "settle" })
  })

  it("自我报告 + 我不是该 Prediction 的 Owner ⇒ 只能请本人报告（建题者身份不带来特权）", () => {
    expect(
      decideSettlement({
        oracleKind: "SELF_REPORT",
        hasSource: true,
        callerOwnsForecast: false,
      }),
    ).toEqual({ mode: "requires-human-report" })
  })
})
