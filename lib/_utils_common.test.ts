import { forecastHiddenReasonText, forecastsAreHidden } from "./_utils_common"

/**
 * ADR-0028 锚定保护的守卫。
 *
 * 这组断言存在的理由：漏掉保护**不会有任何症状**——它只是让第二个 Owner 在押注前
 * 看到第一个人的数字。没有失败、没有报错，只是判断不再独立，而那次押注之后仍然
 * 会被计入校准。所以这里的每一条都是"去掉守卫即变红"的那类用例。
 */
describe("forecastsAreHidden —— 锚定保护（ADR-0028）", () => {
  const question = (over: Record<string, unknown> = {}) =>
    ({
      resolved: false,
      hideForecastsUntil: null,
      hideForecastsUntilPrediction: false,
      forecasts: [],
      options: null,
      ...over,
    }) as never

  it("多人题 + 我还没押 ⇒ 隐藏（默认保护，不需要建题人手动打开开关）", () => {
    expect(
      forecastsAreHidden(
        question({ forecasts: [{ userId: "bob" }, { userId: "alice" }] }),
        "alice-not-yet",
      ),
    ).toBe(true)
  })

  it("多人题 + 我已押 ⇒ 可见", () => {
    expect(
      forecastsAreHidden(
        question({ forecasts: [{ userId: "bob" }, { userId: "alice" }] }),
        "alice",
      ),
    ).toBe(false)
  })

  it("单人题（只有我一个预测者）⇒ 不隐藏：无锚可防", () => {
    expect(
      forecastsAreHidden(
        question({ forecasts: [{ userId: "alice" }] }),
        "alice",
      ),
    ).toBe(false)
    expect(
      forecastsAreHidden(
        question({ forecasts: [{ userId: "alice" }] }),
        undefined,
      ),
    ).toBe(false)
  })

  it("已结算 ⇒ 一律可见（复盘期不受保护影响）", () => {
    expect(
      forecastsAreHidden(
        question({
          resolved: true,
          forecasts: [{ userId: "bob" }, { userId: "alice" }],
        }),
        "alice-not-yet",
      ),
    ).toBe(false)
  })

  it("多选题：我的押注在选项里 ⇒ 可见（不能只看 question.forecasts）", () => {
    expect(
      forecastsAreHidden(
        question({
          forecasts: [],
          options: [
            { forecasts: [{ userId: "bob" }] },
            { forecasts: [{ userId: "alice" }] },
          ],
        }),
        "alice",
      ),
    ).toBe(false)
  })

  it("多选题：我还没押 ⇒ 隐藏", () => {
    expect(
      forecastsAreHidden(
        question({
          forecasts: [],
          options: [
            { forecasts: [{ userId: "bob" }] },
            { forecasts: [{ userId: "carol" }] },
          ],
        }),
        "alice-not-yet",
      ),
    ).toBe(true)
  })

  it("未登录的浏览者不受锚定保护影响（沿用上游的公开行为）", () => {
    expect(
      forecastsAreHidden(
        question({ forecasts: [{ userId: "bob" }, { userId: "alice" }] }),
        undefined,
      ),
    ).toBe(false)
  })

  it("既有的 hideForecastsUntilPrediction 仍然生效（不是被新规则取代）", () => {
    expect(
      forecastsAreHidden(
        question({
          hideForecastsUntilPrediction: true,
          forecasts: [{ userId: "alice" }, { userId: "bob" }],
        }),
        "nobody",
      ),
    ).toBe(true)
  })
})

/**
 * 隐藏原因文案。
 *
 * 它存在是因为 ADR-0028 的多人题保护**没有显式开关**，所以“隐藏了”这件事必须
 * 自己说清楚“怎么才能看到”；返回空字符串会让界面只说前半句，而后者才是可行动的
 * 信息。这条分支此前无断言（改动前的实现恰好返回空串）。
 */
describe("forecastHiddenReasonText —— 隐藏原因", () => {
  const reason = (over: Record<string, unknown> = {}) =>
    forecastHiddenReasonText({
      hideForecastsUntil: null,
      hideForecastsUntilPrediction: false,
      ...over,
    } as never)

  it("ADR-0028 的多人题默认保护（无显式开关）⇒ 仍要说清怎么才能看到", () => {
    // 去掉回归前的修复（返回空串）时，这条变红
    expect(reason()).toBe("until you make a prediction")
    expect(reason()).not.toBe("")
  })

  it("显式的 hideForecastsUntilPrediction 给出同一句话", () => {
    expect(reason({ hideForecastsUntilPrediction: true })).toBe(
      "until you make a prediction",
    )
  })

  it("hideForecastsUntil 给出具体日期（可行动的信息）", () => {
    expect(reason({ hideForecastsUntil: new Date("2026-03-01") })).toBe(
      "until 2026-03-01",
    )
  })

  it("两个条件同时存在时都要说出来", () => {
    expect(
      reason({
        hideForecastsUntil: new Date("2026-03-01"),
        hideForecastsUntilPrediction: true,
      }),
    ).toBe("until you make a prediction and the date is at least 2026-03-01")
  })
})
