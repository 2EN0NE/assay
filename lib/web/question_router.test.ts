import { scrubHiddenForecastsAndSensitiveDetailsFromQuestion } from "./question_router"

/**
 * ADR-0028 锚定保护的**服务端**一半。
 *
 * 为什么必须单独守在这里：`lib/_utils_common.test.ts` 钉住的是"该不该隐藏"这个判断，
 * 而真正决定**响应体里有没有那个数字**的是本文件的函数。两者分离过一次——外层闸门
 * 认了新的多人题默认，逐条抹除却只认两个显式开关，于是保护降级成"界面不渲染"：
 * 第二个押注的人打开网络面板就能读到第一个人的概率。这组用例就是为了让那次分离
 * 不能再发生（去掉 `shouldHideForecast` 里的多人题分支，前两条立刻变红）。
 */

jest.mock("trpc-transformer", () => ({ __esModule: true, default: undefined }))
// 这条链会拽进 node-fetch(ESM) / chart.js（jsdom 下拉不起来）；本文件只用纯函数。
jest.mock("../_utils_server", () => ({
  __esModule: true,
  backendAnalyticsEvent: jest.fn(),
}))
jest.mock("../prisma", () => ({ __esModule: true, default: {} }))

type ScrubResult = {
  forecasts: { userId: string | null; forecast: number | null }[]
  options:
    | { forecasts: { userId: string | null; forecast: number | null }[] }[]
    | null
}

function scrub(question: Record<string, unknown>, userId: string | undefined) {
  return scrubHiddenForecastsAndSensitiveDetailsFromQuestion(
    question as never,
    userId,
  ) as unknown as ScrubResult
}

// 主键用与 userId 无关的值（贴近真实的 cuid）：把 id 写成 `${userId}-f` 会让下面
// “响应体里搜不到他人身份”那条断言因为主键而误报。
let forecastSeq = 0
const forecast = (userId: string, value: number) => ({
  id: `clxforecast${++forecastSeq}`,
  questionId: "q1",
  userId,
  forecast: value,
  endorsed: true,
  createdAt: new Date(0),
})

const question = (over: Record<string, unknown> = {}) => ({
  id: "q1",
  userId: "author",
  resolved: false,
  hideForecastsUntil: null,
  hideForecastsUntilPrediction: false,
  forecasts: [],
  options: null,
  ...over,
})

const ALICE = "alice"
const BOB = "bob"
const CAROL = "carol"

/**
 * 触发 ADR-0028 的场景有**两个**前提：题上已有两个不同的人押过注（共享题是常态，
 * ADR-0025），而**我**不在其中。只有一个预测者时无锚可防——那不是这个保护要管的
 * 情况，把它当成泄漏场景会读错行为。
 */
const twoOthersHavePredicted = () => [forecast(BOB, 0.9), forecast(CAROL, 0.85)]

describe("服务端脱敏：ADR-0028 多人题默认保护（去掉守卫即变红）", () => {
  it("他人已押（两个）+ 我还没押 + 没有显式开关 ⇒ 他人的概率与身份都不出响应体", () => {
    const result = scrub(
      question({ forecasts: twoOthersHavePredicted() }),
      ALICE,
    )

    expect(result.forecasts).toHaveLength(2)
    // 这两条就是守卫本身：少一个都不算"看不见"
    for (const entry of result.forecasts) {
      expect(entry.forecast).toBeNull()
      expect(entry.userId).toBeNull()
    }
  })

  it("抹除是彻底的：序列化后的响应体里搜不到他人的数字与身份", () => {
    const result = scrub(
      question({ forecasts: twoOthersHavePredicted() }),
      ALICE,
    )

    // 逐字段断言容易被新的字段绕过（例如将来多一个 `displayForecast`），
    // 所以再从"整段响应"这一层确认一次。
    const body = JSON.stringify(result)
    expect(body).not.toContain("0.9")
    expect(body).not.toContain("0.85")
    expect(body).not.toContain(BOB)
    expect(body).not.toContain(CAROL)
  })

  it("多人题 + 我已经押过 ⇒ 不抹除（保护的是提交前，不是永远保密）", () => {
    const result = scrub(
      question({ forecasts: [forecast(BOB, 0.9), forecast(ALICE, 0.3)] }),
      ALICE,
    )

    expect(result.forecasts.map((f) => f.forecast)).toEqual([0.9, 0.3])
  })

  it("已结算 ⇒ 一律可见：复盘期不受锚定保护影响", () => {
    const result = scrub(
      question({ resolved: true, forecasts: [forecast(BOB, 0.9)] }),
      ALICE,
    )

    expect(result.forecasts[0].forecast).toBe(0.9)
  })

  it("显式的 hideForecastsUntilPrediction 仍然生效（新规则不是取代它）", () => {
    const result = scrub(
      question({
        hideForecastsUntilPrediction: true,
        forecasts: [forecast(BOB, 0.9)],
      }),
      ALICE,
    )

    expect(result.forecasts[0].forecast).toBeNull()
  })

  it("单人题（只有我一个预测者）⇒ 不抹除：无锚可防", () => {
    const result = scrub(question({ forecasts: [forecast(ALICE, 0.3)] }), ALICE)

    expect(result.forecasts[0].forecast).toBe(0.3)
  })

  it("只有**一个**他人押过、我还没押 ⇒ 不算多人题，不抹除（保护的前提是已有他人的锚）", () => {
    const result = scrub(question({ forecasts: [forecast(BOB, 0.9)] }), ALICE)

    expect(result.forecasts[0].forecast).toBe(0.9)
  })

  it("多选题：他人的押注藏在选项里，同样要抹除", () => {
    const result = scrub(
      question({
        forecasts: [],
        options: [
          { forecasts: [forecast(BOB, 0.9)] },
          { forecasts: [forecast(CAROL, 0.85)] },
        ],
      }),
      ALICE,
    )

    // 只按 `question.forecasts` 判断多预测者的实现会在这里漏掉选项里的人
    expect(result.options?.[0].forecasts[0].forecast).toBeNull()
    expect(result.options?.[1].forecasts[0].forecast).toBeNull()
    expect(JSON.stringify(result)).not.toContain("0.9")
  })

  it("未登录的浏览者不受影响（沿用上游的公开行为）", () => {
    const result = scrub(
      question({ forecasts: [forecast(BOB, 0.9)] }),
      undefined,
    )

    expect(result.forecasts[0].forecast).toBe(0.9)
  })
})
