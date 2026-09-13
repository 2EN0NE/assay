import { Forecast, Question, Resolution } from "@prisma/client"
import { Prisma } from "@prisma/client"
import { dropRelativeScores, relativeBrierScoring } from "./_scoring"

function makeForecast(
  userId: string,
  forecast: number,
  createdAt: Date,
): Forecast {
  return {
    id: Math.floor(Math.random() * 100000),
    createdAt,
    comment: null,
    forecast: new Prisma.Decimal(forecast),
    profileId: null,
    questionId: "q1",
    optionId: null,
    userId,
  } as Forecast
}

function makeQuestion(
  resolution: Resolution,
  resolvedAt = new Date(24 * 60 * 60 * 1000),
): Question {
  return {
    id: "q1",
    createdAt: new Date(0),
    resolvedAt,
    resolution,
  } as Question
}

describe("relativeBrierScoring", () => {
  it("gives a perfect binary forecast an absolute Brier score of 0", () => {
    const question = makeQuestion(Resolution.YES)
    const forecast = makeForecast("u1", 1.0, new Date(0))

    const scores = relativeBrierScoring([forecast], question)

    expect(scores["u1"].absoluteBrierScore).toBeCloseTo(0)
    expect(scores["u1"].rank).toBe(1)
  })

  it("gives a maximally wrong binary forecast a positive Brier score", () => {
    const question = makeQuestion(Resolution.YES)
    const forecast = makeForecast("u1", 0.0, new Date(0))

    const scores = relativeBrierScoring([forecast], question)

    expect(scores["u1"].absoluteBrierScore).toBeCloseTo(2)
  })

  it("ranks multiple users by relative Brier score (better = lower rank)", () => {
    const question = makeQuestion(Resolution.YES)
    const good = makeForecast("good", 0.9, new Date(0))
    const bad = makeForecast("bad", 0.1, new Date(0))

    const scores = relativeBrierScoring([good, bad], question)

    expect(scores["good"].rank).toBe(1)
    expect(scores["bad"].rank).toBe(2)
    expect(scores["good"].relativeBrierScore!).toBeLessThan(
      scores["bad"].relativeBrierScore!,
    )
  })

  it("returns an empty collection for no forecasts", () => {
    const question = makeQuestion(Resolution.YES)
    expect(relativeBrierScoring([], question)).toEqual({})
  })

  it("subtracts the median Brier score for relative scores across 3 users", () => {
    const question = makeQuestion(Resolution.YES)
    const good = makeForecast("good", 0.9, new Date(0))
    const mid = makeForecast("mid", 0.5, new Date(0))
    const bad = makeForecast("bad", 0.1, new Date(0))

    const scores = relativeBrierScoring([good, mid, bad], question)

    // median absolute Brier score of {0.02, 0.5, 1.62} is 0.5
    expect(scores["good"].relativeBrierScore).toBeCloseTo(-0.48)
    expect(scores["mid"].relativeBrierScore).toBeCloseTo(0)
    expect(scores["bad"].relativeBrierScore).toBeCloseTo(1.12)
    expect(scores["good"].rank).toBe(1)
    expect(scores["mid"].rank).toBe(2)
    expect(scores["bad"].rank).toBe(3)
  })

  it("time-weights forecasts when a user updates their prediction", () => {
    const question = makeQuestion(Resolution.YES)
    const early = makeForecast("u1", 0.5, new Date(0))
    const late = makeForecast("u1", 0.9, new Date(12 * 60 * 60 * 1000))

    const scores = relativeBrierScoring([early, late], question)

    // 0.5 for the first half, 0.9 for the second half -> weighted 0.7 -> Brier 0.18
    expect(scores["u1"].absoluteBrierScore).toBeCloseTo(0.18)
  })
})

describe("dropRelativeScores（ADR-0002：非公共事实类不进相对分）", () => {
  it("抹掉相对分，保留绝对分——且必须是 null，不能是 undefined", () => {
    const absoluteOnly = dropRelativeScores({
      good: { relativeBrierScore: -0.48, absoluteBrierScore: 0.02, rank: 1 },
      bad: { relativeBrierScore: 1.12, absoluteBrierScore: 1.62, rank: 2 },
    })

    // 为什么非 null 不可：Prisma 把 undefined 当作「跳过该字段」，于是 create 看着对
    // （列默认值 NULL）而 update 会留住旧的相对分；读侧（global-stats 的
    // `relativeScore !== null` 过滤、AVG 忽略 null）也只认 null。
    expect(absoluteOnly["good"].relativeBrierScore).toBeNull()
    expect(absoluteOnly["good"].absoluteBrierScore).toBeCloseTo(0.02)
    expect(absoluteOnly["bad"].absoluteBrierScore).toBeCloseTo(1.62)
  })

  it("排名改按绝对分——相对分顺序与绝对分顺序可以不同", () => {
    const absoluteOnly = dropRelativeScores({
      // 相对分排序会把 a 排第一，但 a 的绝对分更差
      a: { relativeBrierScore: -1, absoluteBrierScore: 0.9, rank: 1 },
      b: { relativeBrierScore: 1, absoluteBrierScore: 0.1, rank: 2 },
    })

    expect(absoluteOnly["b"].rank).toBe(1)
    expect(absoluteOnly["a"].rank).toBe(2)
  })

  it("空集合保持为空", () => {
    expect(dropRelativeScores({})).toEqual({})
  })
})
